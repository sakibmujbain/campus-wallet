-- ============================================================================
-- Migration 0012 — Student-tunable round-up savings  (Tuition Shield UI)
-- The round-up sweep reads savings_config(enabled, step) but nothing let a
-- student change it. This session-scoped SECURITY DEFINER writer derives the
-- student from the GUC (never a client-supplied id), so a caller can only ever
-- tune their OWN round-up. It does NOT touch locked_until — the Tuition Shield
-- lock is not student-editable.
-- ============================================================================

-- Up Migration

CREATE FUNCTION set_savings_config(p_step INT, p_enabled BOOLEAN)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid BIGINT;
BEGIN
    v_uid := app_current_user();
    IF v_uid IS NULL THEN RAISE EXCEPTION 'no session user' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_step NOT IN (10, 50) THEN RAISE EXCEPTION 'round-up step must be 10 or 50' USING ERRCODE = 'check_violation'; END IF;
    INSERT INTO savings_config (student_id, enabled, step) VALUES (v_uid, p_enabled, p_step)
        ON CONFLICT (student_id) DO UPDATE SET enabled = EXCLUDED.enabled, step = EXCLUDED.step;
END; $$;

GRANT EXECUTE ON FUNCTION set_savings_config(INT, BOOLEAN) TO app_write, app_admin;

-- Down Migration

DROP FUNCTION IF EXISTS set_savings_config(INT, BOOLEAN);
