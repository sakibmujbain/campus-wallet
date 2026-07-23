-- ============================================================================
-- Migration 0009 — Organizer console  (Phase D)
-- Turns the Phase-3 event spine into a real CR/club-exec product:
--   • event lifecycle columns (status/deadline/description/settled_txn_id)
--   • create_drive()      — SCOPE-ENFORCED create + roster auto-populate
--   • add/remove_from_roster(), set_drive_status()
--   • pay_event()         — now rejects payments to a non-'open' drive
--   • settle_event()      — sweeps the pool to an INSTITUTIONAL wallet only
--                           (anti-embezzlement: never a personal/student wallet)
--   • notification spine + remind_defaulters() + mark_notifications_read()
-- Every mutation is admin- or organizer-gated in the function body; scope is
-- verified in code (never UI-only), and all writes carry the audit GUC.
-- ============================================================================

-- Up Migration

-- ═══ Event lifecycle ════════════════════════════════════════════════════════
ALTER TABLE event ADD COLUMN status         TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','closed','settled','cancelled'));
ALTER TABLE event ADD COLUMN deadline        DATE;
ALTER TABLE event ADD COLUMN description      TEXT;
ALTER TABLE event ADD COLUMN settled_txn_id   BIGINT REFERENCES ledger_transaction(txn_id);

-- ═══ In-app notifications (polling inbox; web-push deferred) ═════════════════
CREATE TABLE notification (
    notification_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES app_user(user_id),
    kind            TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT,
    link            TEXT,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notification_inbox ON notification (user_id, read_at, created_at DESC);

-- ═══ Authorization helper ═══════════════════════════════════════════════════
-- True iff the actor is an admin OR holds an organizer grant (cr/club_exec)
-- whose scope EXACTLY covers (scope_kind, scope_ref). Scope enforced in code.
CREATE FUNCTION organizer_covers(p_actor BIGINT, p_scope_kind TEXT, p_scope_ref TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT is_admin(p_actor) OR EXISTS (
        SELECT 1 FROM role_grant
         WHERE user_id = p_actor
           AND capability IN ('cr','club_exec')
           AND scope_kind = p_scope_kind
           AND scope_ref  IS NOT DISTINCT FROM p_scope_ref);
$$;

-- ═══ Create a collection drive (scope-constrained + roster auto-populate) ════
CREATE FUNCTION create_drive(p_actor BIGINT, p_name TEXT, p_scope_kind TEXT, p_scope_ref TEXT,
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

    v_event := create_event(p_name, v_batch, p_actor, v_club);   -- also opens the pooled event wallet
    UPDATE event SET deadline = p_deadline, description = NULLIF(trim(p_description), '') WHERE event_id = v_event;

    -- Snapshot the cohort onto the roster at a flat per-head expected amount.
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

-- ═══ Roster management (organizer/admin only) ═══════════════════════════════
CREATE FUNCTION add_to_roster(p_actor BIGINT, p_event BIGINT, p_student BIGINT, p_expected NUMERIC)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT;
BEGIN
    SELECT organizer_user_id INTO v_org FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may edit the roster' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_expected IS NULL OR p_expected <= 0 THEN
        RAISE EXCEPTION 'expected amount must be positive' USING ERRCODE = 'check_violation'; END IF;
    IF NOT EXISTS (SELECT 1 FROM student WHERE student_id = p_student) THEN
        RAISE EXCEPTION 'no such student %', p_student; END IF;
    INSERT INTO event_roster (event_id, student_id, expected_amount)
        VALUES (p_event, p_student, p_expected)
        ON CONFLICT (event_id, student_id) DO UPDATE SET expected_amount = EXCLUDED.expected_amount;
END; $$;

CREATE FUNCTION remove_from_roster(p_actor BIGINT, p_event BIGINT, p_student BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT;
BEGIN
    SELECT organizer_user_id INTO v_org FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may edit the roster' USING ERRCODE = 'insufficient_privilege'; END IF;
    -- Removing a payer would orphan their contribution accounting — refund first.
    IF EXISTS (SELECT 1 FROM event_contribution WHERE event_id = p_event AND student_id = p_student) THEN
        RAISE EXCEPTION 'cannot remove a student with contributions; refund them first' USING ERRCODE = 'check_violation'; END IF;
    DELETE FROM event_roster WHERE event_id = p_event AND student_id = p_student;
END; $$;

-- ═══ Lifecycle transitions (open ↔ closed, → cancelled) ═════════════════════
CREATE FUNCTION set_drive_status(p_actor BIGINT, p_event BIGINT, p_status TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT; v_cur TEXT;
BEGIN
    SELECT organizer_user_id, status INTO v_org, v_cur FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may change status' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_status NOT IN ('open','closed','cancelled') THEN
        RAISE EXCEPTION 'status must be open, closed, or cancelled (settlement is its own action)' USING ERRCODE = 'check_violation'; END IF;
    IF v_cur IN ('settled','cancelled') THEN
        RAISE EXCEPTION 'a % drive is final', v_cur USING ERRCODE = 'check_violation'; END IF;
    UPDATE event SET status = p_status WHERE event_id = p_event;
END; $$;

-- ═══ pay_event() — REPLACED to reject payment to a non-'open' drive ═════════
CREATE OR REPLACE FUNCTION pay_event(p_student_account BIGINT, p_event BIGINT, p_amount NUMERIC, p_idem UUID, p_description TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_acct BIGINT; v_student BIGINT; v_txn BIGINT; v_ccy CHAR(3); v_status TEXT;
BEGIN
    SELECT ew.account_id, a.currency, e.status INTO v_acct, v_ccy, v_status
      FROM event_wallet ew JOIN account a ON a.account_id = ew.account_id
      JOIN event e ON e.event_id = ew.event_id
     WHERE ew.event_id = p_event;
    IF v_acct IS NULL THEN RAISE EXCEPTION 'event % has no wallet', p_event; END IF;
    IF v_status <> 'open' THEN
        RAISE EXCEPTION 'event % is % — not open for payment', p_event, v_status USING ERRCODE = 'check_violation'; END IF;
    SELECT student_id INTO v_student FROM student_wallet WHERE account_id = p_student_account;
    IF v_student IS NULL THEN RAISE EXCEPTION 'payer % is not a student wallet', p_student_account; END IF;

    v_txn := make_transfer(p_student_account, v_acct, p_amount, v_ccy, p_idem, COALESCE(p_description, 'event payment'));
    IF NOT EXISTS (SELECT 1 FROM ledger_entry WHERE txn_id = v_txn AND account_id = v_acct AND amount > 0) THEN
        RAISE EXCEPTION 'idempotency key % is not a payment into event %', p_idem, p_event USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO event_contribution (event_id, student_id, txn_id, amount)
        VALUES (p_event, v_student, v_txn, p_amount)
        ON CONFLICT (event_id, txn_id) DO NOTHING;
    RETURN v_txn;
END; $$;

-- ═══ Settle a drive to an institutional treasury (destination-restricted) ════
CREATE FUNCTION settle_event(p_actor BIGINT, p_event BIGINT, p_destination BIGINT, p_idem UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT; v_status TEXT; v_existing BIGINT; v_acct BIGINT; v_ccy CHAR(3); v_bal NUMERIC; v_txn BIGINT;
BEGIN
    SELECT e.organizer_user_id, e.status, e.settled_txn_id, ew.account_id, a.currency
      INTO v_org, v_status, v_existing, v_acct, v_ccy
      FROM event e JOIN event_wallet ew ON ew.event_id = e.event_id
      JOIN account a ON a.account_id = ew.account_id
     WHERE e.event_id = p_event;
    IF v_acct IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may settle' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF v_status = 'settled' THEN RETURN v_existing; END IF;   -- idempotent: already settled
    IF v_status = 'cancelled' THEN RAISE EXCEPTION 'a cancelled drive cannot be settled' USING ERRCODE = 'check_violation'; END IF;

    -- ANTI-EMBEZZLEMENT: the pool may only be swept to an institutional treasury,
    -- never a personal/student/pooled wallet the organizer could withdraw from.
    IF NOT EXISTS (SELECT 1 FROM institutional_wallet WHERE account_id = p_destination) THEN
        RAISE EXCEPTION 'settlement destination must be an institutional wallet' USING ERRCODE = 'insufficient_privilege'; END IF;

    SELECT COALESCE(balance, 0) INTO v_bal FROM account_balance WHERE account_id = v_acct;
    IF v_bal > 0 THEN
        v_txn := make_transfer(v_acct, p_destination, v_bal, v_ccy, p_idem, 'event settlement', p_actor);
    END IF;
    UPDATE event SET status = 'settled', settled_txn_id = v_txn WHERE event_id = p_event;
    RETURN v_txn;
END; $$;

-- ═══ Reminders → notifications (organizer/admin only) ═══════════════════════
CREATE FUNCTION remind_defaulters(p_actor BIGINT, p_event BIGINT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT; v_name TEXT; v_count INT;
BEGIN
    SELECT organizer_user_id, name INTO v_org, v_name FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may send reminders' USING ERRCODE = 'insufficient_privilege'; END IF;
    -- Idempotent: skip a defaulter who still has an UNREAD reminder for THIS drive, so a
    -- double-submit (retry, two tabs, organizer+admin) doesn't stack duplicate reminders.
    -- Title carries the drive name, giving per-drive dedup without a schema column.
    INSERT INTO notification (user_id, kind, title, body, link)
        SELECT d.student_id, 'event_reminder',
               'Payment due: ' || v_name,
               'You still owe ৳' || to_char(d.outstanding, 'FM999999990.00') || ' for "' || v_name || '".',
               '/events'
          FROM v_event_defaulters d
         WHERE d.event_id = p_event
           AND NOT EXISTS (
               SELECT 1 FROM notification n
                WHERE n.user_id = d.student_id
                  AND n.kind = 'event_reminder'
                  AND n.title = 'Payment due: ' || v_name
                  AND n.read_at IS NULL);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END; $$;

-- Marks the SESSION user's unread notifications read (identity from the GUC).
CREATE FUNCTION mark_notifications_read()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid BIGINT; v_count INT;
BEGIN
    v_uid := app_current_user();
    IF v_uid IS NULL THEN RAISE EXCEPTION 'no session user' USING ERRCODE = 'insufficient_privilege'; END IF;
    UPDATE notification SET read_at = now() WHERE user_id = v_uid AND read_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END; $$;

-- ═══ Grants ═════════════════════════════════════════════════════════════════
GRANT SELECT ON notification TO app_read, app_write, app_admin;
GRANT EXECUTE ON FUNCTION organizer_covers(BIGINT, TEXT, TEXT) TO app_read, app_write, app_admin;
GRANT EXECUTE ON FUNCTION create_drive(BIGINT, TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT),
                          add_to_roster(BIGINT, BIGINT, BIGINT, NUMERIC),
                          remove_from_roster(BIGINT, BIGINT, BIGINT),
                          set_drive_status(BIGINT, BIGINT, TEXT),
                          settle_event(BIGINT, BIGINT, BIGINT, UUID),
                          remind_defaulters(BIGINT, BIGINT),
                          mark_notifications_read()
    TO app_write, app_admin;

-- Down Migration

DROP FUNCTION IF EXISTS mark_notifications_read();
DROP FUNCTION IF EXISTS remind_defaulters(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS settle_event(BIGINT, BIGINT, BIGINT, UUID);
DROP FUNCTION IF EXISTS set_drive_status(BIGINT, BIGINT, TEXT);
DROP FUNCTION IF EXISTS remove_from_roster(BIGINT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS add_to_roster(BIGINT, BIGINT, BIGINT, NUMERIC);
DROP FUNCTION IF EXISTS create_drive(BIGINT, TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT);
DROP FUNCTION IF EXISTS organizer_covers(BIGINT, TEXT, TEXT);

-- Restore the Phase-3 pay_event() (no status guard), so a partial down + re-up is clean.
CREATE OR REPLACE FUNCTION pay_event(p_student_account BIGINT, p_event BIGINT, p_amount NUMERIC, p_idem UUID, p_description TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_acct BIGINT; v_student BIGINT; v_txn BIGINT; v_ccy CHAR(3);
BEGIN
    SELECT ew.account_id, a.currency INTO v_acct, v_ccy
      FROM event_wallet ew JOIN account a ON a.account_id = ew.account_id
     WHERE ew.event_id = p_event;
    IF v_acct IS NULL THEN RAISE EXCEPTION 'event % has no wallet', p_event; END IF;
    SELECT student_id INTO v_student FROM student_wallet WHERE account_id = p_student_account;
    IF v_student IS NULL THEN RAISE EXCEPTION 'payer % is not a student wallet', p_student_account; END IF;

    v_txn := make_transfer(p_student_account, v_acct, p_amount, v_ccy, p_idem, COALESCE(p_description, 'event payment'));
    IF NOT EXISTS (SELECT 1 FROM ledger_entry WHERE txn_id = v_txn AND account_id = v_acct AND amount > 0) THEN
        RAISE EXCEPTION 'idempotency key % is not a payment into event %', p_idem, p_event USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO event_contribution (event_id, student_id, txn_id, amount)
        VALUES (p_event, v_student, v_txn, p_amount)
        ON CONFLICT (event_id, txn_id) DO NOTHING;
    RETURN v_txn;
END; $$;

DROP INDEX IF EXISTS idx_notification_inbox;
DROP TABLE IF EXISTS notification;

ALTER TABLE event DROP COLUMN IF EXISTS settled_txn_id;
ALTER TABLE event DROP COLUMN IF EXISTS description;
ALTER TABLE event DROP COLUMN IF EXISTS deadline;
ALTER TABLE event DROP COLUMN IF EXISTS status;
