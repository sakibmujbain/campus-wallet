-- ============================================================================
-- Migration 0019 — Editable drive descriptions
--   • update_drive_description(): let a drive's organizer (or an admin) rewrite the
--     description in place, so a pasted run-on blurb can be reformatted without
--     recreating the drive.
--   Metadata only: it never touches the roster, the ledger, or the drive status, so
--   (unlike set_drive_status) it is deliberately allowed on settled/cancelled drives —
--   fixing a typo on a historical record must stay possible.
-- ============================================================================

-- Up Migration

CREATE FUNCTION update_drive_description(p_actor BIGINT, p_event BIGINT, p_description TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT;
BEGIN
    SELECT organizer_user_id INTO v_org FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may edit the description' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF length(COALESCE(p_description, '')) > 2000 THEN
        RAISE EXCEPTION 'description must be 2000 characters or fewer' USING ERRCODE = 'check_violation'; END IF;

    -- blank/whitespace-only clears it, matching how create_drive stores descriptions
    UPDATE event SET description = NULLIF(trim(p_description), '') WHERE event_id = p_event;
END; $$;

GRANT EXECUTE ON FUNCTION update_drive_description(BIGINT, BIGINT, TEXT) TO app_write, app_admin;

-- Down Migration

DROP FUNCTION IF EXISTS update_drive_description(BIGINT, BIGINT, TEXT);
