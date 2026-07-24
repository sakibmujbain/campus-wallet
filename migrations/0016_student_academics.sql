-- ============================================================================
-- Migration 0016 — Student academic profile (department / hall / session)
--   • provision_student() now stores department, hall_id and session at signup
--     (session is kept in the existing student.batch column — the cohort key).
--   • update_student_academics() — self-service edit from the profile page.
--   • add_filtered_to_roster() — bulk-add students matching department/hall/
--     session filters (replaces the hard-coded batch-only cohort add).
-- ============================================================================

-- Up Migration

-- provision_student gains the 3 academic fields (nullable — set on NEW registration
-- only; a pre-seeded student being linked keeps whatever it already has).
DROP FUNCTION IF EXISTS provision_student(UUID, TEXT, TEXT);
CREATE FUNCTION provision_student(p_auth_uid UUID, p_email TEXT, p_full_name TEXT,
                                  p_department TEXT DEFAULT NULL, p_hall_id BIGINT DEFAULT NULL, p_session TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid BIGINT; v_spend BIGINT; v_treasury BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_auth_uid::text, 0));

    SELECT user_id INTO v_uid FROM app_user WHERE auth_uid = p_auth_uid;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;

    SELECT user_id INTO v_uid FROM app_user WHERE lower(email) = lower(p_email) AND role = 'student';
    IF v_uid IS NOT NULL THEN
        UPDATE app_user SET auth_uid = p_auth_uid WHERE user_id = v_uid;
        RETURN v_uid;
    END IF;

    IF lower(p_email) NOT LIKE '%.edu.bd' AND lower(p_email) NOT LIKE '%.du.ac.bd' THEN
        RAISE EXCEPTION 'registration requires a .edu.bd or .du.ac.bd email' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO app_user (email, full_name, role, auth_uid)
        VALUES (p_email, COALESCE(NULLIF(p_full_name, ''), split_part(p_email, '@', 1)), 'student', p_auth_uid)
        RETURNING user_id INTO v_uid;
    INSERT INTO student (student_id, student_no, enrollment_date, hall_id, department, batch)
        VALUES (v_uid, 'STU-' || v_uid, current_date, p_hall_id, NULLIF(trim(p_department), ''), NULLIF(trim(p_session), ''));

    v_spend := open_student_wallet(v_uid, 'spending');
    PERFORM open_student_wallet(v_uid, 'savings');
    INSERT INTO savings_config (student_id, enabled, step) VALUES (v_uid, true, 10);

    INSERT INTO kyc_verification (student_id, method, status, verified_at, expires_at)
        VALUES (v_uid, 'edu_email', 'verified', now(), now() + INTERVAL '1 year');

    SELECT account_id INTO v_treasury FROM system_account WHERE system_role = 'treasury' LIMIT 1;
    IF v_treasury IS NOT NULL THEN
        PERFORM make_transfer(v_treasury, v_spend, 1000.00, 'BDT', gen_random_uuid(), 'welcome credit');
    END IF;

    RETURN v_uid;
END; $$;
GRANT EXECUTE ON FUNCTION provision_student(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) TO app_write, app_admin;

-- Self-service: a student edits their OWN academic info (session stored in batch).
CREATE FUNCTION update_student_academics(p_actor BIGINT, p_department TEXT, p_hall_id BIGINT, p_session TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM student WHERE student_id = p_actor) THEN
        RAISE EXCEPTION 'not a student' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_hall_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hall WHERE hall_id = p_hall_id) THEN
        RAISE EXCEPTION 'no such hall %', p_hall_id USING ERRCODE = 'check_violation'; END IF;
    UPDATE student
       SET department = NULLIF(trim(p_department), ''),
           hall_id    = p_hall_id,
           batch      = NULLIF(trim(p_session), '')
     WHERE student_id = p_actor;
END; $$;
GRANT EXECUTE ON FUNCTION update_student_academics(BIGINT, TEXT, BIGINT, TEXT) TO app_write, app_admin;

-- Bulk-add every student matching the given filters (any subset of department /
-- hall / session) at a flat per-head, skipping anyone already rostered. At least
-- one filter is required so an organizer can't accidentally add the whole campus.
CREATE FUNCTION add_filtered_to_roster(p_actor BIGINT, p_event BIGINT, p_per_head NUMERIC,
                                       p_department TEXT DEFAULT NULL, p_hall_id BIGINT DEFAULT NULL, p_session TEXT DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT; v_count INT;
BEGIN
    SELECT organizer_user_id INTO v_org FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may edit the roster' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_per_head IS NULL OR p_per_head <= 0 THEN
        RAISE EXCEPTION 'per-head amount must be positive' USING ERRCODE = 'check_violation'; END IF;
    IF NULLIF(trim(p_department), '') IS NULL AND p_hall_id IS NULL AND NULLIF(trim(p_session), '') IS NULL THEN
        RAISE EXCEPTION 'choose at least one filter (department, hall, or session)' USING ERRCODE = 'check_violation'; END IF;

    WITH matching AS (
        SELECT s.student_id FROM student s
         WHERE (NULLIF(trim(p_department), '') IS NULL OR s.department = p_department)
           AND (p_hall_id IS NULL                       OR s.hall_id   = p_hall_id)
           AND (NULLIF(trim(p_session), '') IS NULL     OR s.batch     = p_session)
    ), ins AS (
        INSERT INTO event_roster (event_id, student_id, expected_amount)
            SELECT p_event, student_id, p_per_head FROM matching
        ON CONFLICT (event_id, student_id) DO NOTHING
        RETURNING 1
    )
    SELECT count(*)::int INTO v_count FROM ins;
    RETURN v_count;
END; $$;
GRANT EXECUTE ON FUNCTION add_filtered_to_roster(BIGINT, BIGINT, NUMERIC, TEXT, BIGINT, TEXT) TO app_write, app_admin;

-- Down Migration

DROP FUNCTION IF EXISTS add_filtered_to_roster(BIGINT, BIGINT, NUMERIC, TEXT, BIGINT, TEXT);
DROP FUNCTION IF EXISTS update_student_academics(BIGINT, TEXT, BIGINT, TEXT);

-- Restore the 3-arg provision_student (the 0014 .du.ac.bd version).
DROP FUNCTION IF EXISTS provision_student(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT);
CREATE FUNCTION provision_student(p_auth_uid UUID, p_email TEXT, p_full_name TEXT)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid BIGINT; v_spend BIGINT; v_treasury BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_auth_uid::text, 0));
    SELECT user_id INTO v_uid FROM app_user WHERE auth_uid = p_auth_uid;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
    SELECT user_id INTO v_uid FROM app_user WHERE lower(email) = lower(p_email) AND role = 'student';
    IF v_uid IS NOT NULL THEN
        UPDATE app_user SET auth_uid = p_auth_uid WHERE user_id = v_uid;
        RETURN v_uid;
    END IF;
    IF lower(p_email) NOT LIKE '%.edu.bd' AND lower(p_email) NOT LIKE '%.du.ac.bd' THEN
        RAISE EXCEPTION 'registration requires a .edu.bd or .du.ac.bd email' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO app_user (email, full_name, role, auth_uid)
        VALUES (p_email, COALESCE(NULLIF(p_full_name, ''), split_part(p_email, '@', 1)), 'student', p_auth_uid)
        RETURNING user_id INTO v_uid;
    INSERT INTO student (student_id, student_no, enrollment_date)
        VALUES (v_uid, 'STU-' || v_uid, current_date);
    v_spend := open_student_wallet(v_uid, 'spending');
    PERFORM open_student_wallet(v_uid, 'savings');
    INSERT INTO savings_config (student_id, enabled, step) VALUES (v_uid, true, 10);
    INSERT INTO kyc_verification (student_id, method, status, verified_at, expires_at)
        VALUES (v_uid, 'edu_email', 'verified', now(), now() + INTERVAL '1 year');
    SELECT account_id INTO v_treasury FROM system_account WHERE system_role = 'treasury' LIMIT 1;
    IF v_treasury IS NOT NULL THEN
        PERFORM make_transfer(v_treasury, v_spend, 1000.00, 'BDT', gen_random_uuid(), 'welcome credit');
    END IF;
    RETURN v_uid;
END; $$;
GRANT EXECUTE ON FUNCTION provision_student(UUID, TEXT, TEXT) TO app_write, app_admin;
