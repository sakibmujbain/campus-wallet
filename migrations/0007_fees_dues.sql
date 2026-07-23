-- ============================================================================
-- Migration 0007 — Fee catalog, assessed dues, top-up  (Phase B: the core loop)
-- Admin defines fee_items (amount); assessing SNAPSHOTS the amount onto each
-- student's dues. A student pays the EXACT amount (no client-supplied amount, no
-- partials) — routed through make_transfer (NOT make_purchase → mandatory fees
-- earn no loyalty points). Self-service top-up funds the wallet from an external
-- cash-in rail (a payment gateway slots in here later).
-- ============================================================================

-- Up Migration

ALTER TABLE student ADD COLUMN department TEXT;   -- exam fees can scope by department

CREATE TABLE fee_item (
    fee_item_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                 TEXT NOT NULL,
    category             TEXT NOT NULL CHECK (category IN ('exam','hall_rent','cafeteria','library','misc')),
    collector_account_id BIGINT NOT NULL REFERENCES institutional_wallet(account_id),  -- where the money lands
    amount               NUMERIC(20,4) NOT NULL CHECK (amount > 0),                     -- current price
    scope_kind           TEXT NOT NULL DEFAULT 'all' CHECK (scope_kind IN ('all','batch','department','hall')),
    scope_ref            TEXT,
    active               BOOLEAN NOT NULL DEFAULT true,
    created_by           BIGINT REFERENCES app_user(user_id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE student_assessment (
    assessment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id    BIGINT NOT NULL REFERENCES student(student_id),
    fee_item_id   BIGINT NOT NULL REFERENCES fee_item(fee_item_id),
    period        TEXT NOT NULL,
    amount_due    NUMERIC(20,4) NOT NULL CHECK (amount_due > 0),  -- SNAPSHOT at assess time
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','void')),
    assessed_by   BIGINT REFERENCES app_user(user_id),
    assessed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (student_id, fee_item_id, period)
);
CREATE INDEX ix_assessment_student_open ON student_assessment (student_id) WHERE status = 'open';

CREATE TABLE assessment_payment (
    assessment_id BIGINT PRIMARY KEY REFERENCES student_assessment(assessment_id),
    txn_id        BIGINT NOT NULL UNIQUE REFERENCES ledger_transaction(txn_id),  -- one txn backs exactly one assessment
    paid_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit the fee tables (fee edits + assessments are sensitive, per the product decision).
CREATE TRIGGER trg_audit_fee_item   AFTER INSERT OR UPDATE OR DELETE ON fee_item          FOR EACH ROW EXECUTE FUNCTION audit();
CREATE TRIGGER trg_audit_assessment AFTER INSERT OR UPDATE OR DELETE ON student_assessment FOR EACH ROW EXECUTE FUNCTION audit();

-- ── Admin-guarded fee management (admin-only for now; scoped-institution later) ──
CREATE FUNCTION create_fee_item(p_actor BIGINT, p_name TEXT, p_category TEXT, p_collector BIGINT, p_amount NUMERIC, p_scope_kind TEXT DEFAULT 'all', p_scope_ref TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
    IF NOT is_admin(p_actor) THEN RAISE EXCEPTION 'only an admin can create fees' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF (SELECT currency FROM account WHERE account_id = p_collector) IS DISTINCT FROM 'BDT' THEN
        RAISE EXCEPTION 'fee collector must be a BDT wallet (no FX yet)' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO fee_item (name, category, collector_account_id, amount, scope_kind, scope_ref, created_by)
        VALUES (p_name, p_category, p_collector, p_amount, COALESCE(p_scope_kind, 'all'), p_scope_ref, p_actor)
        RETURNING fee_item_id INTO v_id;
    RETURN v_id;
END; $$;

CREATE FUNCTION set_fee_amount(p_actor BIGINT, p_fee_item BIGINT, p_amount NUMERIC)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin(p_actor) THEN RAISE EXCEPTION 'only an admin can edit fees' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive' USING ERRCODE = 'check_violation'; END IF;
    UPDATE fee_item SET amount = p_amount WHERE fee_item_id = p_fee_item;  -- only future assessments; existing dues keep their snapshot
END; $$;

CREATE FUNCTION set_fee_active(p_actor BIGINT, p_fee_item BIGINT, p_active BOOLEAN)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin(p_actor) THEN RAISE EXCEPTION 'only an admin can edit fees' USING ERRCODE = 'insufficient_privilege'; END IF;
    UPDATE fee_item SET active = p_active WHERE fee_item_id = p_fee_item;
END; $$;

-- Assess a fee to its scoped cohort for a period. Idempotent; SNAPSHOTS the amount.
CREATE FUNCTION assess_fees(p_actor BIGINT, p_fee_item BIGINT, p_period TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fee fee_item; v_count INTEGER;
BEGIN
    IF NOT is_admin(p_actor) THEN RAISE EXCEPTION 'only an admin can assess fees' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO v_fee FROM fee_item WHERE fee_item_id = p_fee_item;
    IF v_fee.fee_item_id IS NULL THEN RAISE EXCEPTION 'no such fee item %', p_fee_item; END IF;
    IF NOT v_fee.active THEN RAISE EXCEPTION 'fee item % is inactive', p_fee_item USING ERRCODE = 'check_violation'; END IF;

    WITH cohort AS (
        SELECT s.student_id FROM student s
        WHERE CASE v_fee.scope_kind
                WHEN 'all'        THEN true
                WHEN 'batch'      THEN s.batch = v_fee.scope_ref
                WHEN 'department' THEN s.department = v_fee.scope_ref
                WHEN 'hall'       THEN s.hall_id = (SELECT hall_id FROM hall WHERE name = v_fee.scope_ref)
                ELSE false
              END
    ),
    ins AS (
        INSERT INTO student_assessment (student_id, fee_item_id, period, amount_due, status, assessed_by)
        SELECT student_id, p_fee_item, p_period, v_fee.amount, 'open', p_actor FROM cohort
        ON CONFLICT (student_id, fee_item_id, period) DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO v_count FROM ins;
    RETURN v_count;
END; $$;

-- ── The atomic pay-a-due core ──────────────────────────────────────────────
-- Payer is the SESSION user (app.current_user_id GUC), never a client param.
-- Exact amount (the snapshot), no points, idempotent.
CREATE FUNCTION pay_fee(p_assessment BIGINT, p_idem UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me BIGINT; v_student BIGINT; v_amount NUMERIC(20,4); v_status TEXT; v_collector BIGINT; v_spend BIGINT; v_ccy CHAR(3); v_txn BIGINT; v_paid BIGINT;
BEGIN
    v_me := app_current_user();
    IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege'; END IF;

    SELECT sa.student_id, sa.amount_due, sa.status, fi.collector_account_id
      INTO v_student, v_amount, v_status, v_collector
      FROM student_assessment sa JOIN fee_item fi ON fi.fee_item_id = sa.fee_item_id
     WHERE sa.assessment_id = p_assessment
     FOR UPDATE OF sa;
    IF v_student IS NULL THEN RAISE EXCEPTION 'no such assessment %', p_assessment; END IF;
    IF v_student <> v_me THEN RAISE EXCEPTION 'that fee is not assessed to you' USING ERRCODE = 'insufficient_privilege'; END IF;

    -- True replay: this assessment is already paid → return its original txn (idempotent success).
    SELECT txn_id INTO v_paid FROM assessment_payment WHERE assessment_id = p_assessment;
    IF v_paid IS NOT NULL THEN RETURN v_paid; END IF;
    IF v_status <> 'open' THEN RAISE EXCEPTION 'fee already %', v_status USING ERRCODE = 'check_violation'; END IF;

    SELECT account_id INTO v_spend FROM student_wallet WHERE student_id = v_me AND wallet_purpose = 'spending';
    SELECT currency INTO v_ccy FROM account WHERE account_id = v_collector;

    v_txn := make_transfer(v_spend, v_collector, v_amount, v_ccy, p_idem, 'fee payment');  -- make_transfer, not make_purchase → no points
    -- The key must map to a FRESH payment of THIS exact fee, not a replay of an
    -- unrelated (same-collector) txn — else this due would settle for free.
    IF EXISTS (SELECT 1 FROM assessment_payment WHERE txn_id = v_txn) THEN
        RAISE EXCEPTION 'idempotency key % already settled another fee', p_idem USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ledger_entry WHERE txn_id = v_txn AND account_id = v_collector AND amount = v_amount) THEN
        RAISE EXCEPTION 'idempotency key % is not a payment of this fee', p_idem USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO assessment_payment (assessment_id, txn_id) VALUES (p_assessment, v_txn);  -- UNIQUE(txn_id) backstop
    UPDATE student_assessment SET status = 'paid' WHERE assessment_id = p_assessment;
    RETURN v_txn;
END; $$;

-- ── Self-service demo top-up (external cash-in rail) ───────────────────────
CREATE FUNCTION top_up(p_amount NUMERIC, p_idem UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me BIGINT; v_ext BIGINT; v_spend BIGINT; v_today NUMERIC; v_txn BIGINT;
BEGIN
    v_me := app_current_user();
    IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_amount <= 0 OR p_amount > 100000 THEN RAISE EXCEPTION 'top-up must be between 0 and 100,000 BDT' USING ERRCODE = 'check_violation'; END IF;

    SELECT account_id INTO v_spend FROM student_wallet WHERE student_id = v_me AND wallet_purpose = 'spending';
    -- Demo rail: cap cumulative top-ups per student per day (contains the free-money faucet).
    SELECT COALESCE(SUM(le.amount), 0) INTO v_today
      FROM ledger_entry le JOIN ledger_transaction lt ON lt.txn_id = le.txn_id
     WHERE le.account_id = v_spend AND le.amount > 0 AND lt.kind = 'transfer'
       AND lt.description = 'top-up (demo)' AND lt.created_at >= date_trunc('day', now());
    IF v_today + p_amount > 200000 THEN
        RAISE EXCEPTION 'daily top-up limit (200,000 BDT) reached' USING ERRCODE = 'check_violation';
    END IF;

    SELECT account_id INTO v_ext FROM system_account WHERE system_role = 'external' LIMIT 1;
    IF v_ext IS NULL THEN RAISE EXCEPTION 'no external cash-in account configured'; END IF;

    v_txn := make_transfer(v_ext, v_spend, p_amount, 'BDT', p_idem, 'top-up (demo)');
    IF NOT EXISTS (SELECT 1 FROM ledger_entry WHERE txn_id = v_txn AND account_id = v_spend AND amount = p_amount) THEN
        RAISE EXCEPTION 'idempotency key % already used for a different operation', p_idem USING ERRCODE = 'check_violation';
    END IF;
    RETURN v_txn;
END; $$;

-- ── Student dues view (app filters by student_id — RLS-MVP posture) ─────────
CREATE VIEW v_student_dues AS
SELECT sa.assessment_id,
       sa.student_id,
       fi.name,
       fi.category,
       sa.period,
       sa.amount_due,
       sa.status,
       fi.collector_account_id
FROM student_assessment sa
JOIN fee_item fi ON fi.fee_item_id = sa.fee_item_id;

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT SELECT ON fee_item, student_assessment, assessment_payment, v_student_dues TO app_read, app_write, app_admin;
GRANT EXECUTE ON FUNCTION create_fee_item(BIGINT, TEXT, TEXT, BIGINT, NUMERIC, TEXT, TEXT),
                          set_fee_amount(BIGINT, BIGINT, NUMERIC),
                          set_fee_active(BIGINT, BIGINT, BOOLEAN),
                          assess_fees(BIGINT, BIGINT, TEXT),
                          pay_fee(BIGINT, UUID),
                          top_up(NUMERIC, UUID)
    TO app_write, app_admin;

-- Down Migration

DROP VIEW IF EXISTS v_student_dues;
DROP FUNCTION IF EXISTS top_up(NUMERIC, UUID);
DROP FUNCTION IF EXISTS pay_fee(BIGINT, UUID);
DROP FUNCTION IF EXISTS assess_fees(BIGINT, BIGINT, TEXT);
DROP FUNCTION IF EXISTS set_fee_active(BIGINT, BIGINT, BOOLEAN);
DROP FUNCTION IF EXISTS set_fee_amount(BIGINT, BIGINT, NUMERIC);
DROP FUNCTION IF EXISTS create_fee_item(BIGINT, TEXT, TEXT, BIGINT, NUMERIC, TEXT, TEXT);
DROP TRIGGER IF EXISTS trg_audit_assessment ON student_assessment;
DROP TRIGGER IF EXISTS trg_audit_fee_item   ON fee_item;
DROP TABLE IF EXISTS assessment_payment;
DROP TABLE IF EXISTS student_assessment;
DROP TABLE IF EXISTS fee_item;
ALTER TABLE student DROP COLUMN IF EXISTS department;
