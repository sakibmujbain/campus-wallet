-- ============================================================================
-- CSEDU All Batch Tour 2025 — Bandarban
-- Seeds the 2023-24 first-year CSE cohort (65 students, from the Registrar's
-- admission list) and opens the tour collection drive at the ৳1999 "book your
-- seat" registration fee. Built through the same open_*/submit_kyc/approve_kyc
-- and create_event helpers as db/seed.sql so the account hierarchy, KYC state
-- machine, and event wallet all stay consistent.
--
-- FRESH-REGISTRATION state: every student is rostered at 1999 BDT but NOBODY has
-- paid, so all 65 show on the live defaulter list and the event reads 0% collected.
-- Students are verified but UNFUNDED (they top up to pay, like a real new user).
--
-- Re-runnable: each student is skipped if their student_no already exists, the
-- event is created once, and roster rows use ON CONFLICT DO NOTHING. The 3 demo
-- students (CSE-2021-*/EEE-2022-*) and their data are never touched.
--
-- Source-data notes: birth date, merit rank and class roll are not stored (no
-- schema column). student_no is a clean CSE-2023-### key. The DU registration
-- number is derived from the sequential admission block (2023815943 + serial;
-- e.g. #39 Sakib = 2023-815-982) and embedded in the email as
--   <name>-<regno>@cs.du.ac.bd   (real DU domain; accepted by e-KYC per 0014).
-- Names are transliterated from the Bengali admission list.
--
-- REQUIRES migration 0014 (widens e-KYC to accept .du.ac.bd) applied first.
--
-- Apply:  node scripts/run-sql.mjs db/seed_tour.sql   (or: npm run db:sql db/seed_tour.sql)
-- ============================================================================
DO $$
DECLARE
    v_hall   BIGINT;
    v_lock   DATE := current_date + INTERVAL '120 days';   -- savings lock, matches db/seed.sql
    v_uid    BIGINT;
    v_save   BIGINT;
    v_kyc    BIGINT;
    v_org    BIGINT;
    v_event  BIGINT;
    v_added  INT := 0;
    s        RECORD;
BEGIN
    -- Reuse a seeded hall if one exists; hall_id is nullable, so NULL is fine too.
    SELECT hall_id INTO v_hall FROM hall ORDER BY hall_id LIMIT 1;

    FOR s IN
        SELECT * FROM (VALUES
            ('Mojahidul Islam Sarkar',           'CSE-2023-001'),
            ('Md. Samiul Islam Siam',            'CSE-2023-002'),
            ('Kazi Mahek Tafannum',              'CSE-2023-003'),
            ('Syed Muhtasim Alam',               'CSE-2023-004'),
            ('Rubaiya Sultana',                  'CSE-2023-005'),
            ('Ishtiaq Mahmud Joy',               'CSE-2023-006'),
            ('Partha Kumar Mondal',              'CSE-2023-007'),
            ('Farhan Labib',                     'CSE-2023-008'),
            ('Md. Sajid Alam',                   'CSE-2023-009'),
            ('Salwa Baki',                       'CSE-2023-010'),
            ('Soumik Deb',                       'CSE-2023-011'),
            ('Ahmed Reza Tausif',                'CSE-2023-012'),
            ('Sara Binte Shafayet',              'CSE-2023-013'),
            ('Shadman Zaman Sajid',              'CSE-2023-014'),
            ('Risita Sharmin',                   'CSE-2023-015'),
            ('Ibne Mohammad Al Rifat',           'CSE-2023-016'),
            ('Md. Sajidul Islam',                'CSE-2023-017'),
            ('Md. Sakhawat Hossain',             'CSE-2023-018'),
            ('Raisa Hosain Ratri',               'CSE-2023-019'),
            ('Shashwata Nandi',                  'CSE-2023-020'),
            ('Ariba Hasan',                      'CSE-2023-021'),
            ('Md. Abdullah Bin Sarwar Chowdhury','CSE-2023-022'),
            ('Tahjir Tanseem',                   'CSE-2023-023'),
            ('Sudipta Debnath',                  'CSE-2023-024'),
            ('Mashfiquzzaman Tayeen',            'CSE-2023-025'),
            ('Sojib Ahmed',                      'CSE-2023-026'),
            ('Adiba Jahan',                      'CSE-2023-027'),
            ('Nawas-E-Mustayeen',                'CSE-2023-028'),
            ('Akhtaruzzaman',                    'CSE-2023-029'),
            ('Samarina Sarowar Sachi',           'CSE-2023-030'),
            ('Suchita Islam Shubhra',            'CSE-2023-031'),
            ('Khaja Asif Karim Sromi',           'CSE-2023-032'),
            ('Shahriar Hossain',                 'CSE-2023-033'),
            ('Raima Hridika',                    'CSE-2023-034'),
            ('Md. Irfan Iqbal',                  'CSE-2023-035'),
            ('Swalok Samaddar',                  'CSE-2023-036'),
            ('Orin Saha Turjo',                  'CSE-2023-037'),
            ('Niyamul Gani Sourav',              'CSE-2023-038'),
            ('Sakib Mojbain Sadat',              'CSE-2023-039'),
            ('Mohammad Mahmudul Kabir Fahmid',   'CSE-2023-040'),
            ('Mahzabin Meem',                    'CSE-2023-041'),
            ('Zahid Hasan Danny',                'CSE-2023-042'),
            ('Md. Rakibul Hasan',                'CSE-2023-043'),
            ('Faiyaz Ibne Iqbal',                'CSE-2023-044'),
            ('Miskatul Ferdousi',                'CSE-2023-045'),
            ('Raisa Tabassum Payel',             'CSE-2023-046'),
            ('Nahid Shadman',                    'CSE-2023-047'),
            ('Md. Tukabbir Hosain Sadi',         'CSE-2023-048'),
            ('Nafis Mobarrat',                   'CSE-2023-049'),
            ('Syed Mahtab Hossain',              'CSE-2023-050'),
            ('Dipa Biswas',                      'CSE-2023-051'),
            ('Tahseen Mubashshir',               'CSE-2023-052'),
            ('Shehzad Mahbub',                   'CSE-2023-053'),
            ('Md. Ariful Islam',                 'CSE-2023-054'),
            ('Nahian Ashhab',                    'CSE-2023-055'),
            ('Arnab Saha',                       'CSE-2023-056'),
            ('Md. Tahsinur Rahman',              'CSE-2023-057'),
            ('Md. Shahadat Hossain Riyad',       'CSE-2023-058'),
            ('Md. Sajjad Shahriar Ragib',        'CSE-2023-059'),
            ('S. Humaira',                       'CSE-2023-060'),
            ('Shahriar Islam',                   'CSE-2023-061'),
            ('Maisha Binte Liton',               'CSE-2023-062'),
            ('Tamim Hasan',                      'CSE-2023-063'),
            ('Md. Asmaul Hasan Shanto',          'CSE-2023-064'),
            ('Animesh Singha Ayan',              'CSE-2023-065')
        ) AS t(full_name, student_no)
    LOOP
        CONTINUE WHEN EXISTS (SELECT 1 FROM student WHERE student_no = s.student_no);

        -- app_user + 1:1 student. Email = <name>-<regno>@cs.du.ac.bd (real DU domain,
        -- accepted by submit_kyc('edu_email') after 0014). regno = 2023815943 + serial,
        -- the sequential admission block anchored on #39 Sakib = 2023-815-982.
        -- Enrollment ~2 years back (as db/seed.sql) keeps them active/verified today.
        INSERT INTO app_user (email, full_name, role)
            VALUES (
                lower(regexp_replace(s.full_name, '[^A-Za-z0-9]', '', 'g'))
                    || '-' || (2023815943 + right(s.student_no, 3)::int)::text
                    || '@cs.du.ac.bd',
                s.full_name, 'student')
            RETURNING user_id INTO v_uid;
        INSERT INTO student (student_id, student_no, enrollment_date, hall_id, batch)
            VALUES (v_uid, s.student_no, (current_date - INTERVAL '2 years')::date, v_hall, '2023');

        -- Spending wallet (unfunded) + a locked savings wallet with round-ups on.
        PERFORM open_student_wallet(v_uid, 'spending');
        v_save := open_student_wallet(v_uid, 'savings');
        UPDATE student_wallet SET locked_until = v_lock WHERE account_id = v_save;
        INSERT INTO savings_config (student_id, enabled, step, locked_until)
            VALUES (v_uid, true, 10, v_lock);

        -- e-KYC verified via the .edu.bd address.
        v_kyc := submit_kyc(v_uid, 'edu_email');
        PERFORM approve_kyc(v_kyc);

        v_added := v_added + 1;
    END LOOP;

    -- Organizer: Sakib Mojbain Sadat (#39); fall back to the first cohort member.
    SELECT student_id INTO v_org FROM student WHERE student_no = 'CSE-2023-039';
    IF v_org IS NULL THEN
        SELECT student_id INTO v_org FROM student WHERE student_no LIKE 'CSE-2023-%' ORDER BY student_no LIMIT 1;
    END IF;

    -- The tour collection drive (created once). Batch label '2023'; no club.
    SELECT event_id INTO v_event FROM event WHERE name = 'CSEDU All Batch Tour 2025 - Bandarban';
    IF v_event IS NULL THEN
        v_event := create_event('CSEDU All Batch Tour 2025 - Bandarban', '2023', v_org, NULL);
    END IF;

    -- Roster the whole cohort at the 1999 BDT booking fee (idempotent).
    INSERT INTO event_roster (event_id, student_id, expected_amount)
        SELECT v_event, student_id, 1999.00
          FROM student
         WHERE student_no LIKE 'CSE-2023-%'
    ON CONFLICT (event_id, student_id) DO NOTHING;

    RAISE NOTICE 'CSEDU tour seed: % new students added; event % rostered (65 @ 1999 BDT), none paid yet',
        v_added, v_event;
END $$;
