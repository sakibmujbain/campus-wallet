-- ============================================================================
-- Migration 0015 — Bulk roster fill
-- Adding students one user-id at a time is tedious. add_cohort_to_roster() lets
-- an organizer snapshot the drive's OWN cohort (its batch students and/or club
-- members) onto the roster at a flat per-head, without clobbering anyone already
-- listed (their custom expected amount is preserved). Same organizer/admin gate
-- as add_to_roster(). Individual search-and-add stays via add_to_roster().
-- ============================================================================

-- Up Migration

CREATE FUNCTION add_cohort_to_roster(p_actor BIGINT, p_event BIGINT, p_per_head NUMERIC)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT; v_batch TEXT; v_club BIGINT; v_count INT;
BEGIN
    SELECT organizer_user_id, batch, club_id INTO v_org, v_batch, v_club
      FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may edit the roster' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_per_head IS NULL OR p_per_head <= 0 THEN
        RAISE EXCEPTION 'per-head amount must be positive' USING ERRCODE = 'check_violation'; END IF;
    IF v_batch IS NULL AND v_club IS NULL THEN
        RAISE EXCEPTION 'this drive has no batch or club cohort to add' USING ERRCODE = 'check_violation'; END IF;

    -- The drive's cohort = its batch students UNION its club members. New rows only:
    -- ON CONFLICT DO NOTHING keeps any already-listed student's custom expected amount.
    WITH cohort AS (
        SELECT student_id FROM student      WHERE v_batch IS NOT NULL AND batch   = v_batch
        UNION
        SELECT student_id FROM club_member  WHERE v_club  IS NOT NULL AND club_id = v_club
    ), ins AS (
        INSERT INTO event_roster (event_id, student_id, expected_amount)
            SELECT p_event, student_id, p_per_head FROM cohort
        ON CONFLICT (event_id, student_id) DO NOTHING
        RETURNING 1
    )
    SELECT count(*)::int INTO v_count FROM ins;
    RETURN v_count;
END; $$;

GRANT EXECUTE ON FUNCTION add_cohort_to_roster(BIGINT, BIGINT, NUMERIC) TO app_write, app_admin;

-- Down Migration

DROP FUNCTION IF EXISTS add_cohort_to_roster(BIGINT, BIGINT, NUMERIC);
