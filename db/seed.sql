-- Campus demo seed (Phase 1): halls, institutional wallets, a system treasury,
-- and students each with a funded spending wallet + a savings wallet — all built
-- through the open_* helpers so the disjoint+total subtype hierarchy is honored.
-- Safe to re-run (skips when students already exist).
DO $$
DECLARE
    v_hall1    BIGINT;
    v_treasury BIGINT;
    v_exam     BIGINT;
    v_cafe     BIGINT;
    v_halladm  BIGINT;
    v_uid      BIGINT;
    v_spend    BIGINT;
    s          RECORD;
BEGIN
    IF EXISTS (SELECT 1 FROM student) THEN
        RAISE NOTICE 'seed skipped — students already exist';
        RETURN;
    END IF;

    -- Halls
    INSERT INTO hall (name) VALUES ('Shaheed Smriti Hall') RETURNING hall_id INTO v_hall1;
    INSERT INTO hall (name) VALUES ('Bangabandhu Hall');

    -- System + institutional payees
    v_treasury := open_system_account('treasury', 'BDT', -1000000000000000);  -- opening treasury (may go negative)
    v_exam     := open_exam_wallet('CSE');
    v_cafe     := open_cafeteria_wallet('Central Cafeteria', 'IOT-CAF-01');
    v_halladm  := open_hall_wallet(v_hall1);

    -- Students: app_user + student + spending & savings wallets, spending funded 1000 BDT
    FOR s IN
        SELECT * FROM (VALUES
            ('Ayesha Rahman', 'ayesha@student.university.edu.bd', 'CSE-2021-001', '2021'),
            ('Sakib Hasan',   'sakib@student.university.edu.bd',  'CSE-2021-002', '2021'),
            ('Nadia Islam',   'nadia@student.university.edu.bd',  'EEE-2022-014', '2022')
        ) AS t(full_name, email, student_no, batch)
    LOOP
        INSERT INTO app_user (email, full_name, role)
            VALUES (s.email, s.full_name, 'student') RETURNING user_id INTO v_uid;
        INSERT INTO student (student_id, student_no, enrollment_date, hall_id, batch)
            VALUES (v_uid, s.student_no, (s.batch || '-08-01')::date, v_hall1, s.batch);

        v_spend := open_student_wallet(v_uid, 'spending');
        PERFORM open_student_wallet(v_uid, 'savings');
        PERFORM make_transfer(v_treasury, v_spend, 1000.00, 'BDT', gen_random_uuid(), 'opening balance');
    END LOOP;

    -- One demo campus payment so the hub has activity: Ayesha pays a 500 BDT exam fee.
    PERFORM make_transfer(
        (SELECT sw.account_id FROM student_wallet sw
           JOIN student st ON st.student_id = sw.student_id
          WHERE st.student_no = 'CSE-2021-001' AND sw.wallet_purpose = 'spending'),
        v_exam, 500.00, 'BDT', gen_random_uuid(), 'exam fee — CSE');

    RAISE NOTICE 'seed complete: 2 halls, 3 institutional payees, 3 students';
END $$;
