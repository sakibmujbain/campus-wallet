-- ============================================================================
-- Migration 0017 — Drop the CLUBS feature
--   club, club_member, club_overlap() (the INTERSECT demo). Collection drives
--   become batch-scoped only; event.club_id is removed. Dues/fees are untouched.
-- Net: 33 tables -> 31.
-- ============================================================================

-- Up Migration

DROP FUNCTION IF EXISTS club_overlap(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS add_cohort_to_roster(BIGINT, BIGINT, NUMERIC);  -- batch/club cohort add (superseded by add_filtered_to_roster)

-- create_event without club_id (keeps its p_club arg for caller compatibility, ignored).
CREATE OR REPLACE FUNCTION create_event(p_name TEXT, p_batch TEXT, p_organizer BIGINT, p_club BIGINT DEFAULT NULL, p_currency CHAR(3) DEFAULT 'BDT')
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event BIGINT; v_acct BIGINT;
BEGIN
    INSERT INTO event (name, batch, organizer_user_id) VALUES (p_name, p_batch, p_organizer) RETURNING event_id INTO v_event;
    INSERT INTO account (account_kind, currency) VALUES ('pooled', p_currency) RETURNING account_id INTO v_acct;
    INSERT INTO pooled_wallet (account_id, pool_kind, owner_user_id) VALUES (v_acct, 'event', p_organizer);
    INSERT INTO event_wallet (account_id, event_id) VALUES (v_acct, v_event);
    RETURN v_event;
END; $$;

-- Batch-only create_drive (club scope removed).
CREATE OR REPLACE FUNCTION create_drive(p_actor BIGINT, p_name TEXT, p_scope_kind TEXT, p_scope_ref TEXT,
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

    INSERT INTO event_roster (event_id, student_id, expected_amount)
        SELECT v_event, student_id, p_per_head FROM student WHERE batch = p_scope_ref
        ON CONFLICT (event_id, student_id) DO NOTHING;
    RETURN v_event;
END; $$;

ALTER TABLE event DROP COLUMN IF EXISTS club_id;   -- drops the FK to club with it
DROP TABLE IF EXISTS club_member;
DROP TABLE IF EXISTS club;

-- Down Migration

CREATE TABLE club (
    club_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE
);
CREATE TABLE club_member (
    club_id    BIGINT NOT NULL REFERENCES club(club_id),
    student_id BIGINT NOT NULL REFERENCES student(student_id),
    PRIMARY KEY (club_id, student_id)
);
ALTER TABLE event ADD COLUMN club_id BIGINT REFERENCES club(club_id);

CREATE OR REPLACE FUNCTION create_event(p_name TEXT, p_batch TEXT, p_organizer BIGINT, p_club BIGINT DEFAULT NULL, p_currency CHAR(3) DEFAULT 'BDT')
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event BIGINT; v_acct BIGINT;
BEGIN
    INSERT INTO event (name, batch, organizer_user_id, club_id) VALUES (p_name, p_batch, p_organizer, p_club) RETURNING event_id INTO v_event;
    INSERT INTO account (account_kind, currency) VALUES ('pooled', p_currency) RETURNING account_id INTO v_acct;
    INSERT INTO pooled_wallet (account_id, pool_kind, owner_user_id) VALUES (v_acct, 'event', p_organizer);
    INSERT INTO event_wallet (account_id, event_id) VALUES (v_acct, v_event);
    RETURN v_event;
END; $$;

CREATE OR REPLACE FUNCTION create_drive(p_actor BIGINT, p_name TEXT, p_scope_kind TEXT, p_scope_ref TEXT,
                             p_per_head NUMERIC, p_deadline DATE DEFAULT NULL, p_description TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event BIGINT; v_club BIGINT; v_batch TEXT;
BEGIN
    IF p_scope_kind NOT IN ('batch','club') THEN
        RAISE EXCEPTION 'drive scope must be batch or club' USING ERRCODE = 'check_violation'; END IF;
    IF NOT organizer_covers(p_actor, p_scope_kind, p_scope_ref) THEN
        RAISE EXCEPTION 'you may only create drives for a scope you were granted' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_per_head IS NULL OR p_per_head <= 0 THEN
        RAISE EXCEPTION 'per-head amount must be positive' USING ERRCODE = 'check_violation'; END IF;
    IF p_scope_kind = 'club' THEN
        SELECT club_id INTO v_club FROM club WHERE name = p_scope_ref;
        IF v_club IS NULL THEN RAISE EXCEPTION 'no club named %', p_scope_ref; END IF;
    ELSE
        v_batch := p_scope_ref;
    END IF;
    v_event := create_event(p_name, v_batch, p_actor, v_club);
    UPDATE event SET deadline = p_deadline, description = NULLIF(trim(p_description), '') WHERE event_id = v_event;
    IF p_scope_kind = 'batch' THEN
        INSERT INTO event_roster (event_id, student_id, expected_amount)
            SELECT v_event, student_id, p_per_head FROM student WHERE batch = p_scope_ref
            ON CONFLICT (event_id, student_id) DO NOTHING;
    ELSE
        INSERT INTO event_roster (event_id, student_id, expected_amount)
            SELECT v_event, cm.student_id, p_per_head FROM club_member cm WHERE cm.club_id = v_club
            ON CONFLICT (event_id, student_id) DO NOTHING;
    END IF;
    RETURN v_event;
END; $$;

CREATE FUNCTION club_overlap(p_club_a BIGINT, p_club_b BIGINT)
RETURNS TABLE (student_id BIGINT) LANGUAGE sql STABLE AS $$
    SELECT student_id FROM club_member WHERE club_id = p_club_a
    INTERSECT
    SELECT student_id FROM club_member WHERE club_id = p_club_b;
$$;

CREATE FUNCTION add_cohort_to_roster(p_actor BIGINT, p_event BIGINT, p_per_head NUMERIC)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT; v_batch TEXT; v_club BIGINT; v_count INT;
BEGIN
    SELECT organizer_user_id, batch, club_id INTO v_org, v_batch, v_club FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may edit the roster' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_per_head IS NULL OR p_per_head <= 0 THEN
        RAISE EXCEPTION 'per-head amount must be positive' USING ERRCODE = 'check_violation'; END IF;
    IF v_batch IS NULL AND v_club IS NULL THEN
        RAISE EXCEPTION 'this drive has no batch or club cohort to add' USING ERRCODE = 'check_violation'; END IF;
    WITH cohort AS (
        SELECT student_id FROM student      WHERE v_batch IS NOT NULL AND batch   = v_batch
        UNION
        SELECT student_id FROM club_member  WHERE v_club  IS NOT NULL AND club_id = v_club
    ), ins AS (
        INSERT INTO event_roster (event_id, student_id, expected_amount)
            SELECT p_event, student_id, p_per_head FROM cohort
        ON CONFLICT (event_id, student_id) DO NOTHING RETURNING 1
    )
    SELECT count(*)::int INTO v_count FROM ins;
    RETURN v_count;
END; $$;

GRANT SELECT ON club, club_member TO app_read, app_write, app_admin;
GRANT EXECUTE ON FUNCTION club_overlap(BIGINT, BIGINT) TO app_read, app_write, app_admin;
GRANT EXECUTE ON FUNCTION add_cohort_to_roster(BIGINT, BIGINT, NUMERIC) TO app_write, app_admin;
