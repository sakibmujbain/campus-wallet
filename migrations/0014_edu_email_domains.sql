-- ============================================================================
-- Migration 0014 — Accept .du.ac.bd (real University of Dhaka) alongside .edu.bd
-- The campus is University of Dhaka, whose student email domain is du.ac.bd. The
-- original .edu.bd-only e-KYC rule (0003 submit_kyc, 0005 provision_student) is
-- widened to accept EITHER .edu.bd (the demo domain) OR .du.ac.bd (real DU), so
-- real students verify via edu-email while the existing demo accounts keep working.
-- ============================================================================

-- Up Migration

CREATE OR REPLACE FUNCTION submit_kyc(p_student BIGINT, p_method TEXT, p_doc_key TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
    IF p_method = 'edu_email'
       AND NOT EXISTS (
           SELECT 1 FROM app_user
            WHERE user_id = p_student
              AND (lower(email) LIKE '%.edu.bd' OR lower(email) LIKE '%.du.ac.bd')
       ) THEN
        RAISE EXCEPTION 'edu_email verification requires a .edu.bd or .du.ac.bd address' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO kyc_verification (student_id, method, id_doc_key)
        VALUES (p_student, p_method, p_doc_key) RETURNING verification_id INTO v_id;
    RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION provision_student(p_auth_uid UUID, p_email TEXT, p_full_name TEXT)
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

    -- New registration: accept .edu.bd (demo) OR .du.ac.bd (real DU).
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

-- Down Migration

-- Restore the .edu.bd-only rule on both functions.
CREATE OR REPLACE FUNCTION submit_kyc(p_student BIGINT, p_method TEXT, p_doc_key TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
    IF p_method = 'edu_email'
       AND NOT EXISTS (SELECT 1 FROM app_user WHERE user_id = p_student AND lower(email) LIKE '%.edu.bd') THEN
        RAISE EXCEPTION 'edu_email verification requires a .edu.bd address' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO kyc_verification (student_id, method, id_doc_key)
        VALUES (p_student, p_method, p_doc_key) RETURNING verification_id INTO v_id;
    RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION provision_student(p_auth_uid UUID, p_email TEXT, p_full_name TEXT)
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
    IF lower(p_email) NOT LIKE '%.edu.bd' THEN
        RAISE EXCEPTION 'registration requires a .edu.bd email' USING ERRCODE = 'check_violation';
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
