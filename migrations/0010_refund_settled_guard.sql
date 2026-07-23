-- ============================================================================
-- Migration 0010 — Refunds are closed once a drive is settled  (Phase D polish)
-- After settle_event() sweeps the pool to a treasury, the event wallet is empty.
-- A refund would then try to debit an empty pool and fail with a cryptic
-- "overdraft floor" error. Guard refund_event() to reject settled drives with a
-- clear, mapped (422) message. Refunds stay allowed on open/closed/cancelled
-- drives (a cancelled drive's pool still holds money to return).
-- ============================================================================

-- Up Migration

CREATE OR REPLACE FUNCTION refund_event(p_event BIGINT, p_student_account BIGINT, p_amount NUMERIC, p_idem UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_acct BIGINT; v_student BIGINT; v_txn BIGINT; v_ccy CHAR(3); v_net NUMERIC; v_status TEXT;
BEGIN
    IF p_amount <= 0 THEN RAISE EXCEPTION 'refund amount must be positive' USING ERRCODE = 'check_violation'; END IF;
    SELECT ew.account_id, a.currency, e.status INTO v_acct, v_ccy, v_status
      FROM event_wallet ew JOIN account a ON a.account_id = ew.account_id
      JOIN event e ON e.event_id = ew.event_id
     WHERE ew.event_id = p_event;
    IF v_acct IS NULL THEN RAISE EXCEPTION 'event % has no wallet', p_event; END IF;
    IF v_status = 'settled' THEN
        RAISE EXCEPTION 'drive % is settled — its funds were transferred to the treasury, so refunds are closed', p_event
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT student_id INTO v_student FROM student_wallet WHERE account_id = p_student_account;
    IF v_student IS NULL THEN RAISE EXCEPTION 'payee % is not a student wallet', p_student_account; END IF;

    -- CAP: never refund more than this student's own net contribution — otherwise the
    -- refund would pay them out of OTHER students' money sitting in the shared pool.
    SELECT COALESCE(SUM(amount), 0) INTO v_net
      FROM event_contribution WHERE event_id = p_event AND student_id = v_student;
    IF p_amount > v_net THEN
        RAISE EXCEPTION 'refund % exceeds student net contribution % for event %', p_amount, v_net, p_event
            USING ERRCODE = 'check_violation';
    END IF;

    v_txn := make_transfer(v_acct, p_student_account, p_amount, v_ccy, p_idem, 'event refund');
    IF NOT EXISTS (SELECT 1 FROM ledger_entry WHERE txn_id = v_txn AND account_id = v_acct AND amount < 0) THEN
        RAISE EXCEPTION 'idempotency key % is not a refund from event %', p_idem, p_event USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO event_contribution (event_id, student_id, txn_id, amount, status)
        VALUES (p_event, v_student, v_txn, -p_amount, 'refunded')
        ON CONFLICT (event_id, txn_id) DO NOTHING;
    RETURN v_txn;
END; $$;

-- Down Migration

-- Restore the Phase-3 refund_event() (no settled-status guard).
CREATE OR REPLACE FUNCTION refund_event(p_event BIGINT, p_student_account BIGINT, p_amount NUMERIC, p_idem UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_acct BIGINT; v_student BIGINT; v_txn BIGINT; v_ccy CHAR(3); v_net NUMERIC;
BEGIN
    IF p_amount <= 0 THEN RAISE EXCEPTION 'refund amount must be positive' USING ERRCODE = 'check_violation'; END IF;
    SELECT ew.account_id, a.currency INTO v_acct, v_ccy
      FROM event_wallet ew JOIN account a ON a.account_id = ew.account_id
     WHERE ew.event_id = p_event;
    IF v_acct IS NULL THEN RAISE EXCEPTION 'event % has no wallet', p_event; END IF;
    SELECT student_id INTO v_student FROM student_wallet WHERE account_id = p_student_account;
    IF v_student IS NULL THEN RAISE EXCEPTION 'payee % is not a student wallet', p_student_account; END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_net
      FROM event_contribution WHERE event_id = p_event AND student_id = v_student;
    IF p_amount > v_net THEN
        RAISE EXCEPTION 'refund % exceeds student net contribution % for event %', p_amount, v_net, p_event
            USING ERRCODE = 'check_violation';
    END IF;

    v_txn := make_transfer(v_acct, p_student_account, p_amount, v_ccy, p_idem, 'event refund');
    IF NOT EXISTS (SELECT 1 FROM ledger_entry WHERE txn_id = v_txn AND account_id = v_acct AND amount < 0) THEN
        RAISE EXCEPTION 'idempotency key % is not a refund from event %', p_idem, p_event USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO event_contribution (event_id, student_id, txn_id, amount, status)
        VALUES (p_event, v_student, v_txn, -p_amount, 'refunded')
        ON CONFLICT (event_id, txn_id) DO NOTHING;
    RETURN v_txn;
END; $$;
