-- ============================================================================
-- Migration 0005 — Auth link  (Frontend: Identity & e-KYC)
-- Links a Supabase Auth user (UUID) to our app_user (BIGINT) and provides an
-- idempotent provisioning function that, on a student's first authenticated
-- visit, creates their app_user + student + wallets + savings config + a
-- VERIFIED e-KYC record (the .edu.bd email was checked at sign-up) and drops a
-- welcome credit so the account is immediately usable.
-- ============================================================================

-- Up Migration

ALTER TABLE app_user ADD COLUMN auth_uid UUID UNIQUE;   -- Supabase auth.users id
COMMENT ON COLUMN app_user.auth_uid IS 'Links this app_user to a Supabase Auth user.';

-- Idempotent: returns the existing app_user for a known auth_uid/email, otherwise
-- provisions a full student. SECURITY DEFINER (the app roles hold only SELECT).
CREATE FUNCTION provision_student(p_auth_uid UUID, p_email TEXT, p_full_name TEXT)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid BIGINT; v_spend BIGINT; v_treasury BIGINT;
BEGIN
    -- Serialize provisioning per auth user, so two concurrent first-requests (the
    -- dashboard's router.push + router.refresh can overlap) don't both INSERT and
    -- crash the loser with a unique-violation. The loser blocks, then finds the row.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_auth_uid::text, 0));

    -- Already provisioned for this auth user?
    SELECT user_id INTO v_uid FROM app_user WHERE auth_uid = p_auth_uid;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;

    -- Pre-existing STUDENT with this email (e.g. seeded)? Link it. Restricted to
    -- role='student' so a signup can never bind to an institution/admin account
    -- (which would leave getStudent with no student row).
    SELECT user_id INTO v_uid FROM app_user WHERE lower(email) = lower(p_email) AND role = 'student';
    IF v_uid IS NOT NULL THEN
        UPDATE app_user SET auth_uid = p_auth_uid WHERE user_id = v_uid;
        RETURN v_uid;
    END IF;

    -- New registration: enforce the .edu.bd rule (defense-in-depth; the app checks too).
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

    -- e-KYC: the .edu.bd email was verified at sign-up, so record a verified check.
    INSERT INTO kyc_verification (student_id, method, status, verified_at, expires_at)
        VALUES (v_uid, 'edu_email', 'verified', now(), now() + INTERVAL '1 year');

    -- Welcome credit (only if a treasury is seeded) so the account is demo-ready.
    SELECT account_id INTO v_treasury FROM system_account WHERE system_role = 'treasury' LIMIT 1;
    IF v_treasury IS NOT NULL THEN
        PERFORM make_transfer(v_treasury, v_spend, 1000.00, 'BDT', gen_random_uuid(), 'welcome credit');
    END IF;

    RETURN v_uid;
END; $$;

GRANT EXECUTE ON FUNCTION provision_student(UUID, TEXT, TEXT) TO app_write, app_admin;

-- Down Migration

DROP FUNCTION IF EXISTS provision_student(UUID, TEXT, TEXT);
ALTER TABLE app_user DROP COLUMN IF EXISTS auth_uid;
