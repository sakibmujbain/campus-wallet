-- ============================================================================
-- DU reference data + backfill
--   1. Insert University of Dhaka residential halls into the hall table (the
--      signup/profile/roster hall dropdown reads from here). Idempotent.
--   2. Backfill EXISTING students' department / hall / session with random valid
--      picks from the option pools, so the roster filters have varied demo data.
--      (Session lives in student.batch — the cohort key.)
--
-- Apply AFTER migration 0016.  node scripts/run-sql.mjs db/seed_du_reference.sql
-- ============================================================================

INSERT INTO hall (name) VALUES
    ('Salimullah Muslim Hall'),
    ('Dr. Muhammad Shahidullah Hall'),
    ('Fazlul Huq Muslim Hall'),
    ('Shahid Sergeant Zahurul Haq Hall'),
    ('Haji Muhammad Mohsin Hall'),
    ('Sir A. F. Rahman Hall'),
    ('Jagannath Hall'),
    ('Masterda Surya Sen Hall'),
    ('Kabi Jasimuddin Hall'),
    ('Muktijoddha Ziaur Rahman Hall'),
    ('Bijoy Ekattor Hall'),
    ('Amar Ekushey Hall'),
    ('Bangabandhu Sheikh Mujibur Rahman Hall'),
    ('Begum Rokeya Hall'),
    ('Shamsun Nahar Hall'),
    ('Kabi Sufia Kamal Hall'),
    ('Bangamata Sheikh Fazilatunnesa Mujib Hall')
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
    depts TEXT[] := ARRAY[
        'Computer Science and Engineering','Electrical and Electronic Engineering',
        'Applied Physics, Electronics and Communication Engineering','Nuclear Engineering',
        'Robotics and Mechatronics Engineering','Biomedical Engineering','Institute of Information Technology',
        'Physics','Chemistry','Mathematics','Statistics','Applied Mathematics','Theoretical Physics',
        'Biomedical Physics and Technology','Botany','Zoology','Biochemistry and Molecular Biology','Microbiology',
        'Genetic Engineering and Biotechnology','Soil, Water and Environment','Fisheries','Psychology',
        'Clinical Psychology','Institute of Nutrition and Food Science','Pharmaceutical Chemistry',
        'Pharmaceutical Technology','Clinical Pharmacy and Pharmacology','Geology','Geography and Environment',
        'Oceanography','Meteorology','Disaster Science and Climate Resilience','Accounting and Information Systems',
        'Management','Marketing','Finance','Banking and Insurance','Management Information Systems',
        'International Business','Organization Strategy and Leadership','Tourism and Hospitality Management',
        'Institute of Business Administration','Bangla','English','Arabic','Persian Language and Literature','Urdu',
        'Sanskrit','Pali and Buddhist Studies','History','Islamic History and Culture','Philosophy','Islamic Studies',
        'Information Science and Library Management','Linguistics','Theatre and Performance Studies','Music',
        'World Religions and Culture','Dance','Economics','Political Science','International Relations','Sociology',
        'Public Administration','Anthropology','Population Sciences','Peace and Conflict Studies',
        'Women and Gender Studies','Development Studies','Communication and Journalism',
        'Mass Communication and Journalism','Printing and Publication Studies','Criminology','Japanese Studies',
        'Law','Law and Land Management','Drawing and Painting','Graphic Design','Printmaking','Oriental Art',
        'Ceramics','Sculpture','Craft','History of Art','Institute of Education and Research','Health Economics',
        'Educational and Counselling Psychology','Institute of Modern Languages'
    ];
    sessions TEXT[] := ARRAY['2025-26','2024-25','2023-24','2022-23','2021-22','2020-21','2019-20','2018-19'];
    hall_ids BIGINT[];
    s RECORD;
BEGIN
    SELECT array_agg(hall_id) INTO hall_ids FROM hall;
    FOR s IN SELECT student_id FROM student LOOP
        UPDATE student SET
            department = depts[1 + floor(random() * array_length(depts, 1))::int],
            hall_id    = hall_ids[1 + floor(random() * array_length(hall_ids, 1))::int],
            batch      = sessions[1 + floor(random() * array_length(sessions, 1))::int]
        WHERE student_id = s.student_id;
    END LOOP;
    RAISE NOTICE 'DU reference: % halls present; backfilled academics for all students', array_length(hall_ids, 1);
END $$;
