-- ============================================================================
-- Migration 0021 — Roster scope is independent of the drive's authorising scope
--   A drive is AUTHORISED by the organizer's granted batch scope (organizer_covers),
--   but WHO ends up on the roster is a separate question: a departmental tour wants
--   every CSE student regardless of session, a hall drive wants every resident
--   regardless of department. create_empty_drive() stamps event.batch from the
--   authorising scope, which mislabels those drives.
--   • set_drive_batch(): re-label (or clear) a drive's batch after creation, so the
--     chip shows the roster's actual session — or nothing when it spans sessions.
--   Additive: create_empty_drive keeps its signature, so a deploy window where old
--   code is still live stays safe.
-- ============================================================================

-- Up Migration

CREATE FUNCTION set_drive_batch(p_actor BIGINT, p_event BIGINT, p_batch TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT;
BEGIN
    SELECT organizer_user_id INTO v_org FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may relabel a drive' USING ERRCODE = 'insufficient_privilege'; END IF;

    -- NULL/blank clears the chip: the drive is not tied to one session
    UPDATE event SET batch = NULLIF(trim(p_batch), '') WHERE event_id = p_event;
END; $$;

GRANT EXECUTE ON FUNCTION set_drive_batch(BIGINT, BIGINT, TEXT) TO app_write, app_admin;

-- Down Migration

DROP FUNCTION IF EXISTS set_drive_batch(BIGINT, BIGINT, TEXT);
