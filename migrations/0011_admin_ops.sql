-- ============================================================================
-- Migration 0011 — Admin control-plane operations  (Phase E: admin depth)
-- The Phase-0..3 helpers approve_kyc()/open_*_wallet() have NO in-body admin
-- check — they predate the role model. The admin console reaches them only
-- through admin-gated routes, but defense-in-depth (and the project's review
-- discipline) wants the privileged mutation itself to verify the caller. These
-- thin SECURITY DEFINER wrappers add is_admin() gating + a clear error, and run
-- under withTransaction({userId}) so audit_log.changed_by is attributed.
-- ============================================================================

-- Up Migration

-- Approve a pending/expired e-KYC verification (admin only).
CREATE FUNCTION admin_approve_kyc(p_actor BIGINT, p_verification BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin(p_actor) THEN
        RAISE EXCEPTION 'only an admin can approve a verification' USING ERRCODE = 'insufficient_privilege'; END IF;
    UPDATE kyc_verification
       SET status = 'verified', verified_at = now(), expires_at = now() + INTERVAL '1 year'
     WHERE verification_id = p_verification AND status IN ('pending','expired');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no pending or expired verification % to approve', p_verification; END IF;
END; $$;

-- One collection wallet per hall / exam department / physical till device. These
-- UNIQUE backstops make a duplicate provisioning (retry, double-submit, concurrent
-- admins) raise 23505 (mapped to 422) instead of silently splitting a payee.
ALTER TABLE exam_controller     ADD CONSTRAINT uq_exam_department UNIQUE (department);
ALTER TABLE hall_administration ADD CONSTRAINT uq_hall_admin_hall UNIQUE (hall_id);
CREATE UNIQUE INDEX uq_cafeteria_device ON cafeteria_till (iot_device_id) WHERE iot_device_id IS NOT NULL;

-- Provision a campus payee wallet (admin only). Dispatches to the existing
-- open_*_wallet builders by kind: exam(department) / hall(hall_id) / cafeteria(location, device?).
-- Pre-checks give a friendly message for the common (sequential) duplicate; the UNIQUE
-- constraints above are the race-safe backstop for a genuine concurrent double-submit.
CREATE FUNCTION admin_open_payee(p_actor BIGINT, p_kind TEXT, p_ref TEXT, p_ref2 TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT; v_ref TEXT := trim(p_ref); v_dev TEXT := NULLIF(trim(COALESCE(p_ref2, '')), '');
BEGIN
    IF NOT is_admin(p_actor) THEN
        RAISE EXCEPTION 'only an admin can create a payee' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF v_ref IS NULL OR v_ref = '' THEN
        RAISE EXCEPTION 'a payee reference is required' USING ERRCODE = 'check_violation'; END IF;

    IF p_kind = 'exam' THEN
        IF EXISTS (SELECT 1 FROM exam_controller WHERE department = v_ref) THEN
            RAISE EXCEPTION 'an exam payee already exists for department %', v_ref; END IF;
        v_id := open_exam_wallet(v_ref);
    ELSIF p_kind = 'cafeteria' THEN
        IF v_dev IS NOT NULL AND EXISTS (SELECT 1 FROM cafeteria_till WHERE iot_device_id = v_dev) THEN
            RAISE EXCEPTION 'a till with device % already exists', v_dev; END IF;
        v_id := open_cafeteria_wallet(v_ref, v_dev);
    ELSIF p_kind = 'hall' THEN
        IF v_ref !~ '^\d+$' THEN RAISE EXCEPTION 'hall reference must be a hall id' USING ERRCODE = 'check_violation'; END IF;
        IF NOT EXISTS (SELECT 1 FROM hall WHERE hall_id = v_ref::BIGINT) THEN
            RAISE EXCEPTION 'no such hall %', v_ref; END IF;
        IF EXISTS (SELECT 1 FROM hall_administration WHERE hall_id = v_ref::BIGINT) THEN
            RAISE EXCEPTION 'a hall payee already exists for hall %', v_ref; END IF;
        v_id := open_hall_wallet(v_ref::BIGINT);
    ELSE
        RAISE EXCEPTION 'unknown payee kind % (expected exam|hall|cafeteria)', p_kind USING ERRCODE = 'check_violation';
    END IF;
    RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION admin_approve_kyc(BIGINT, BIGINT),
                          admin_open_payee(BIGINT, TEXT, TEXT, TEXT)
    TO app_write, app_admin;

-- Down Migration

DROP FUNCTION IF EXISTS admin_open_payee(BIGINT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS admin_approve_kyc(BIGINT, BIGINT);
DROP INDEX IF EXISTS uq_cafeteria_device;
ALTER TABLE hall_administration DROP CONSTRAINT IF EXISTS uq_hall_admin_hall;
ALTER TABLE exam_controller     DROP CONSTRAINT IF EXISTS uq_exam_department;
