-- Campus demo seed: halls, institutional payees, a treasury + loyalty pool, and
-- students each with a funded spending wallet + a LOCKED savings wallet, an
-- approved e-KYC, and round-up savings enabled. Built through the open_*/*_kyc
-- helpers so the hierarchy, state machine, and savings all stay consistent.
-- Safe to re-run (skips when students already exist).
DO $$
DECLARE
    v_hall1    BIGINT;
    v_treasury BIGINT;
    v_pool     BIGINT;
    v_exam     BIGINT;
    v_cafe     BIGINT;
    v_halladm  BIGINT;
    v_uid      BIGINT;
    v_spend    BIGINT;
    v_save     BIGINT;
    v_kyc      BIGINT;
    v_clubA    BIGINT;
    v_clubB    BIGINT;
    v_event    BIGINT;
    v_lock     DATE := current_date + INTERVAL '120 days';   -- Tuition Shield until end of term
    s          RECORD;
BEGIN
    IF EXISTS (SELECT 1 FROM student) THEN
        RAISE NOTICE 'seed skipped — students already exist';
        RETURN;
    END IF;

    INSERT INTO hall (name) VALUES ('Shaheed Smriti Hall') RETURNING hall_id INTO v_hall1;
    INSERT INTO hall (name) VALUES ('Bangabandhu Hall');

    v_treasury := open_system_account('treasury',     'BDT', -1000000000000000);
    v_pool     := open_system_account('loyalty_pool', 'BDT', -1000000000000000);  -- funds redemptions
    v_exam     := open_exam_wallet('CSE');
    v_cafe     := open_cafeteria_wallet('Central Cafeteria', 'IOT-CAF-01');
    v_halladm  := open_hall_wallet(v_hall1);

    FOR s IN
        SELECT * FROM (VALUES
            ('Ayesha Rahman', 'ayesha@student.university.edu.bd', 'CSE-2021-001', '2021'),
            ('Sakib Hasan',   'sakib@student.university.edu.bd',  'CSE-2021-002', '2021'),
            ('Nadia Islam',   'nadia@student.university.edu.bd',  'EEE-2022-014', '2022')
        ) AS t(full_name, email, student_no, batch)
    LOOP
        INSERT INTO app_user (email, full_name, role)
            VALUES (s.email, s.full_name, 'student') RETURNING user_id INTO v_uid;
        -- Enrollment ~2 years ago so students resolve as active/verified today
        -- (a fixed 2021 date would make them alumni at the demo date).
        INSERT INTO student (student_id, student_no, enrollment_date, hall_id, batch)
            VALUES (v_uid, s.student_no, (current_date - INTERVAL '2 years')::date, v_hall1, s.batch);

        -- Wallets: fund spending 1000 BDT; lock the savings bucket.
        v_spend := open_student_wallet(v_uid, 'spending');
        v_save  := open_student_wallet(v_uid, 'savings');
        UPDATE student_wallet SET locked_until = v_lock WHERE account_id = v_save;
        PERFORM make_transfer(v_treasury, v_spend, 1000.00, 'BDT', gen_random_uuid(), 'opening balance');

        -- Round-up savings enabled (nearest 10).
        INSERT INTO savings_config (student_id, enabled, step, locked_until) VALUES (v_uid, true, 10, v_lock);

        -- e-KYC via .edu.bd email, then approved.
        v_kyc := submit_kyc(v_uid, 'edu_email');
        PERFORM approve_kyc(v_kyc);
    END LOOP;

    -- Demo purchase with a non-round amount so round-up + loyalty are visible:
    -- Ayesha pays a 497 BDT exam fee -> 3 BDT swept to savings, floor(497*0.1)=49 points.
    PERFORM make_purchase(
        (SELECT sw.account_id FROM student_wallet sw
           JOIN student st ON st.student_id = sw.student_id
          WHERE st.student_no = 'CSE-2021-001' AND sw.wallet_purpose = 'spending'),
        v_exam, 497.00, 'BDT', gen_random_uuid(), 'exam fee — CSE');

    -- Clubs with overlapping membership (Sakib is in both) for the INTERSECT demo.
    INSERT INTO club (name) VALUES ('Programming Club') RETURNING club_id INTO v_clubA;
    INSERT INTO club (name) VALUES ('Robotics Club')    RETURNING club_id INTO v_clubB;
    INSERT INTO club_member (club_id, student_id)
        SELECT v_clubA, student_id FROM student WHERE student_no IN ('CSE-2021-001','CSE-2021-002');
    INSERT INTO club_member (club_id, student_id)
        SELECT v_clubB, student_id FROM student WHERE student_no IN ('CSE-2021-002','EEE-2022-014');

    -- A batch event: roster of all 3 @ 500 BDT. Ayesha pays in full, Sakib pays
    -- partially, Nadia not at all -> Sakib + Nadia show on the live defaulter list.
    v_event := create_event('CSE Batch Picnic', '2021',
        (SELECT user_id FROM app_user WHERE lower(email) = 'ayesha@student.university.edu.bd'), v_clubA);
    INSERT INTO event_roster (event_id, student_id, expected_amount)
        SELECT v_event, student_id, 500.00 FROM student WHERE student_no IN ('CSE-2021-001','CSE-2021-002','EEE-2022-014');
    PERFORM pay_event((SELECT sw.account_id FROM student_wallet sw JOIN student st ON st.student_id = sw.student_id
                        WHERE st.student_no = 'CSE-2021-001' AND sw.wallet_purpose = 'spending'), v_event, 500.00, gen_random_uuid());
    PERFORM pay_event((SELECT sw.account_id FROM student_wallet sw JOIN student st ON st.student_id = sw.student_id
                        WHERE st.student_no = 'CSE-2021-002' AND sw.wallet_purpose = 'spending'), v_event, 200.00, gen_random_uuid());

    RAISE NOTICE 'seed complete: 2 halls, 3 payees, treasury+loyalty pool, 3 students, 2 clubs, 1 event';
END $$;
