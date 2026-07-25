-- ============================================================================
-- Migration 0018 — Hand-picked drive rosters
--   • create_empty_drive(): create a collection drive WITHOUT auto-rostering the
--     whole batch cohort, so an organizer can hand-pick members afterward on the
--     drive console (by department, hall, session, or individually — the console's
--     existing add-filtered / search-add controls).
--   Additive only: create_drive is left unchanged, so already-deployed code that
--   calls the 7-arg create_drive keeps working during the deploy window.
-- ============================================================================

-- Up Migration

CREATE FUNCTION create_empty_drive(p_actor BIGINT, p_name TEXT, p_scope_kind TEXT, p_scope_ref TEXT,
                             p_per_head NUMERIC, p_deadline DATE DEFAULT NULL, p_description TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event BIGINT;
BEGIN
    IF p_scope_kind <> 'batch' THEN
        RAISE EXCEPTION 'drive scope must be batch' USING ERRCODE = 'check_violation'; END IF;
    IF NOT organizer_covers(p_actor, 'batch', p_scope_ref) THEN
        RAISE EXCEPTION 'you may only create drives for a scope you were granted' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_per_head IS NULL OR p_per_head <= 0 THEN
        RAISE EXCEPTION 'per-head amount must be positive' USING ERRCODE = 'check_violation'; END IF;

    v_event := create_event(p_name, p_scope_ref, p_actor, NULL);   -- opens the pooled event wallet
    UPDATE event SET deadline = p_deadline, description = NULLIF(trim(p_description), '') WHERE event_id = v_event;
    -- deliberately NO event_roster insert: the organizer hand-picks members on the console.
    RETURN v_event;
END; $$;

GRANT EXECUTE ON FUNCTION create_empty_drive(BIGINT, TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT) TO app_write, app_admin;

-- Down Migration

DROP FUNCTION IF EXISTS create_empty_drive(BIGINT, TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT);
