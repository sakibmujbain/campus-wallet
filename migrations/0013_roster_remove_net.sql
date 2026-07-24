-- ============================================================================
-- Migration 0013 — remove_from_roster: gate on NET contribution, not row-existence
-- Bug: event_contribution keeps BOTH the payment (+amount) and the refund
-- (-amount) rows, so a fully-refunded student (net 0, no money in the pool) still
-- had rows and could NOT be removed from the roster — the guard used EXISTS. A
-- student is only unsafe to remove when their NET is still positive (money sitting
-- in the shared pool). Switch the guard to SUM(amount) > 0.
-- ============================================================================

-- Up Migration

CREATE OR REPLACE FUNCTION remove_from_roster(p_actor BIGINT, p_event BIGINT, p_student BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT; v_net NUMERIC;
BEGIN
    SELECT organizer_user_id INTO v_org FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may edit the roster' USING ERRCODE = 'insufficient_privilege'; END IF;
    -- Block only if the student still has money in the pool. A fully-refunded
    -- student nets to 0 and is safe to remove; their historical payment/refund
    -- contribution rows stay as immutable ledger history.
    SELECT COALESCE(SUM(amount), 0) INTO v_net FROM event_contribution WHERE event_id = p_event AND student_id = p_student;
    IF v_net > 0 THEN
        RAISE EXCEPTION 'cannot remove a student with % still in the pool; refund them first', v_net USING ERRCODE = 'check_violation'; END IF;
    DELETE FROM event_roster WHERE event_id = p_event AND student_id = p_student;
END; $$;

-- Down Migration

-- Restore the 0009 version (row-existence guard).
CREATE OR REPLACE FUNCTION remove_from_roster(p_actor BIGINT, p_event BIGINT, p_student BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT;
BEGIN
    SELECT organizer_user_id INTO v_org FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may edit the roster' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF EXISTS (SELECT 1 FROM event_contribution WHERE event_id = p_event AND student_id = p_student) THEN
        RAISE EXCEPTION 'cannot remove a student with contributions; refund them first' USING ERRCODE = 'check_violation'; END IF;
    DELETE FROM event_roster WHERE event_id = p_event AND student_id = p_student;
END; $$;
