-- ============================================================================
-- Migration 0023 — Retiring finished drives (archive, not delete)
--   "After settling or refunding, shouldn't a drive be deletable?" — no, and the
--   schema already says so in two places:
--     • Every payment into a drive is a ledger_entry on its pooled wallet, and the
--       ledger is append-only (trg_ledger_balanced / trg_txn_has_legs check the
--       zero-sum invariant at COMMIT). Removing those rows would unbalance the books
--       and destroy the audit trail.
--     • forbid_subtype_delete() blocks deleting event_wallet/pooled_wallet outright:
--       "retire the account via status, not by deleting its subtype". Accounts are
--       CLOSED, never dropped, so the account→subtype hierarchy can't develop holes.
--   So the answer to an ever-growing list is archiving: the drive leaves the working
--   lists and its pooled wallet is closed, while every row stays auditable.
-- ============================================================================

-- Up Migration

ALTER TABLE event ADD COLUMN archived_at TIMESTAMPTZ;
COMMENT ON COLUMN event.archived_at IS
    'Set when a finished drive is filed away; it stays queryable but drops out of the working lists.';

CREATE FUNCTION set_drive_archived(p_actor BIGINT, p_event BIGINT, p_archived BOOLEAN)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT; v_status TEXT; v_acct BIGINT; v_balance NUMERIC; v_used BOOLEAN;
BEGIN
    SELECT organizer_user_id, status INTO v_org, v_status FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may archive a drive' USING ERRCODE = 'insufficient_privilege'; END IF;

    SELECT ew.account_id, COALESCE(ab.balance, 0)
      INTO v_acct, v_balance
      FROM event_wallet ew LEFT JOIN account_balance ab ON ab.account_id = ew.account_id
     WHERE ew.event_id = p_event;

    IF p_archived THEN
        -- Never file away a drive that is still holding students' money: a cancelled
        -- drive keeps its contributions until they are refunded, and hiding it would
        -- strand that balance somewhere nobody is looking.
        IF COALESCE(v_balance, 0) <> 0 THEN
            RAISE EXCEPTION 'this drive still holds %, refund or settle it first', v_balance
                USING ERRCODE = 'check_violation'; END IF;

        -- Either it finished properly, or it never took a payment at all (a drive created
        -- by mistake is exactly the case people want gone, and it has nothing to protect).
        v_used := EXISTS (SELECT 1 FROM event_contribution WHERE event_id = p_event);
        IF v_status NOT IN ('settled', 'cancelled') AND v_used THEN
            RAISE EXCEPTION 'settle or cancel this drive before archiving it' USING ERRCODE = 'check_violation'; END IF;

        UPDATE event SET archived_at = now() WHERE event_id = p_event;
        -- Close the pooled wallet the way the schema intends — by status, never by delete.
        IF v_acct IS NOT NULL THEN
            UPDATE account SET status = 'closed' WHERE account_id = v_acct; END IF;
    ELSE
        UPDATE event SET archived_at = NULL WHERE event_id = p_event;
        IF v_acct IS NOT NULL THEN
            UPDATE account SET status = 'active' WHERE account_id = v_acct; END IF;
    END IF;
END; $$;

GRANT EXECUTE ON FUNCTION set_drive_archived(BIGINT, BIGINT, BOOLEAN) TO app_write, app_admin;

-- Archiving must actually STOP collection, not merely hide the drive. A drive that has taken
-- no payment YET can be archived while still 'open' (that is the created-by-mistake case), and
-- without this guard a student holding a stale tab could still pay into a wallet that is closed
-- and invisible to its organizer — money nobody is looking at. Everything else is unchanged.
CREATE OR REPLACE FUNCTION pay_event(p_student_account BIGINT, p_event BIGINT, p_amount NUMERIC, p_idem UUID, p_description TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_acct BIGINT; v_student BIGINT; v_txn BIGINT; v_ccy CHAR(3); v_status TEXT; v_archived TIMESTAMPTZ;
BEGIN
    SELECT ew.account_id, a.currency, e.status, e.archived_at
      INTO v_acct, v_ccy, v_status, v_archived
      FROM event_wallet ew JOIN account a ON a.account_id = ew.account_id
      JOIN event e ON e.event_id = ew.event_id
     WHERE ew.event_id = p_event;
    IF v_acct IS NULL THEN RAISE EXCEPTION 'event % has no wallet', p_event; END IF;
    IF v_archived IS NOT NULL THEN
        RAISE EXCEPTION 'event % is archived — not open for payment', p_event USING ERRCODE = 'check_violation'; END IF;
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

-- Down Migration

-- Restore pay_event without the archived guard (archived_at is dropped below).
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

DROP FUNCTION IF EXISTS set_drive_archived(BIGINT, BIGINT, BOOLEAN);
ALTER TABLE event DROP COLUMN IF EXISTS archived_at;
