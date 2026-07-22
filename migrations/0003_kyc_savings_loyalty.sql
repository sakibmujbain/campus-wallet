-- ============================================================================
-- Migration 0003 — e-KYC · Round-Up Savings · Loyalty  (Phase 2)
-- Layers three trigger/procedure/derived-attribute features onto the ledger:
--   • a DATA-DRIVEN finite state machine (one generic trigger over a
--     state_transition table) governing e-KYC verification;
--   • recursion-safe round-up micro-savings ("Tuition Shield");
--   • a loyalty engine whose point balance is a DERIVED aggregate, with an
--     atomic points->BDT redemption and a RANK() leaderboard.
-- ============================================================================

-- Up Migration

-- ═══ 1. Generic finite state machine ════════════════════════════════════════
-- The legal-transition graph is DATA (queryable/diagrammable), not hardcoded IFs.
CREATE TABLE state_transition (
    entity_type TEXT NOT NULL,
    from_state  TEXT NOT NULL,
    to_state    TEXT NOT NULL,
    PRIMARY KEY (entity_type, from_state, to_state)
);

INSERT INTO state_transition (entity_type, from_state, to_state) VALUES
    ('kyc', 'pending',  'verified'),
    ('kyc', 'pending',  'expired'),   -- rejected / lapsed before verifying
    ('kyc', 'verified', 'expired'),
    ('kyc', 'verified', 'alumni'),
    ('kyc', 'expired',  'verified'),  -- re-verification
    ('kyc', 'expired',  'alumni');

-- One reusable engine. The entity_type is passed as a trigger argument, so the
-- SAME function later governs escrow and multisig lifecycles (Phase 5).
CREATE FUNCTION enforce_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM state_transition
        WHERE entity_type = TG_ARGV[0] AND from_state = OLD.status AND to_state = NEW.status
    ) THEN
        RAISE EXCEPTION 'illegal % transition: % -> %', TG_ARGV[0], OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END; $$;

-- ═══ 2. e-KYC verification ══════════════════════════════════════════════════
CREATE TABLE kyc_verification (
    verification_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id      BIGINT NOT NULL REFERENCES student(student_id),
    method          TEXT NOT NULL CHECK (method IN ('edu_email','id_card')),
    -- lowercase states used identically in the enum-CHECK, the partial index,
    -- state_transition rows, and every procedure (no casing drift).
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','verified','expired','alumni')),
    verified_at     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    id_doc_key      TEXT,   -- Supabase Storage object key; the image is NOT stored in the DB
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one ACTIVE verification per student (declarative invariant).
CREATE UNIQUE INDEX one_active_kyc ON kyc_verification (student_id)
    WHERE status IN ('pending','verified');

CREATE TRIGGER trg_kyc_transition
    BEFORE UPDATE ON kyc_verification
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)  -- skip no-op updates (don't false-reject)
    EXECUTE FUNCTION enforce_transition('kyc');

-- kyc_verification holds id_doc_key (a Storage key to a government-ID scan), so
-- protect it like the wallet tables: owner-scoped RLS + the generic audit trail.
-- The submit_kyc/approve_kyc writers are SECURITY DEFINER, so they still write
-- under the bypassrls owner.
ALTER TABLE kyc_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_verification FORCE ROW LEVEL SECURITY;
CREATE POLICY kyc_owner ON kyc_verification FOR SELECT USING (student_id = app_current_user());
CREATE TRIGGER trg_audit_kyc AFTER INSERT OR UPDATE OR DELETE ON kyc_verification
    FOR EACH ROW EXECUTE FUNCTION audit();

-- Submit a verification request. The .edu.bd rule is enforced for the email path.
-- SECURITY DEFINER: the app roles hold only SELECT, so writes must run as the owner.
CREATE FUNCTION submit_kyc(p_student BIGINT, p_method TEXT, p_doc_key TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
    IF p_method = 'edu_email'
       AND NOT EXISTS (SELECT 1 FROM app_user WHERE user_id = p_student AND lower(email) LIKE '%.edu.bd') THEN
        RAISE EXCEPTION 'edu_email verification requires a .edu.bd address' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO kyc_verification (student_id, method, id_doc_key)
        VALUES (p_student, p_method, p_doc_key) RETURNING verification_id INTO v_id;
    RETURN v_id;
END; $$;

-- Admin action: pending/expired -> verified, valid for one year.
CREATE FUNCTION approve_kyc(p_verification BIGINT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE kyc_verification
       SET status = 'verified', verified_at = now(), expires_at = now() + INTERVAL '1 year'
     WHERE verification_id = p_verification;
END; $$;

-- Effective status: derived from the student's enrollment_date (single source of
-- truth for the 4-year Alumni rule) and expiry, as a backstop if the cron sweep
-- has not run yet.
CREATE VIEW v_kyc_effective WITH (security_invoker = true) AS
SELECT k.verification_id,
       k.student_id,
       k.method,
       k.status AS stored_status,
       CASE
           -- only a previously-verified student becomes alumni; a never-verified
           -- 'pending' row must not surface as alumni (downgrade_alumni can't reach it).
           WHEN k.status IN ('verified','expired') AND s.enrollment_date + INTERVAL '4 years' <= now() THEN 'alumni'
           WHEN k.status = 'verified' AND k.expires_at IS NOT NULL AND k.expires_at < now() THEN 'expired'
           ELSE k.status
       END AS effective_status,
       s.enrollment_date,
       k.verified_at,
       k.expires_at
FROM kyc_verification k
JOIN student s ON s.student_id = k.student_id;

-- Scheduled temporal jobs (PROCEDUREs — the CALL/commit-capable counterpart to
-- FUNCTIONs, showcasing the distinction). Driven by pg_cron below.
CREATE PROCEDURE expire_verifications() LANGUAGE plpgsql AS $$
BEGIN
    UPDATE kyc_verification
       SET status = 'expired'
     WHERE status = 'verified' AND expires_at IS NOT NULL AND expires_at < now();
END; $$;

CREATE PROCEDURE downgrade_alumni() LANGUAGE plpgsql AS $$
BEGIN
    UPDATE kyc_verification k
       SET status = 'alumni'
      FROM student s
     WHERE k.student_id = s.student_id
       AND k.status IN ('verified','expired')
       AND s.enrollment_date + INTERVAL '4 years' <= now();
END; $$;

-- ═══ 3. Round-up micro-savings ("Tuition Shield") ══════════════════════════
CREATE TABLE savings_config (
    student_id   BIGINT PRIMARY KEY REFERENCES student(student_id),
    enabled      BOOLEAN NOT NULL DEFAULT true,
    step         INT NOT NULL DEFAULT 10 CHECK (step IN (10, 50)),  -- round up to nearest 10 or 50
    locked_until DATE
);

-- make_purchase(): like make_transfer but tags legs 'purchase' (so the round-up
-- trigger fires) and awards loyalty points to the paying student. SECURITY
-- DEFINER (bypassrls owner) so it writes the ledger under FORCE RLS.
CREATE FUNCTION make_purchase(
    p_from BIGINT, p_to BIGINT, p_amount NUMERIC, p_currency CHAR(3),
    p_idem UUID, p_description TEXT DEFAULT NULL, p_created_by BIGINT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_txn BIGINT; v_student BIGINT; v_rate NUMERIC; v_points NUMERIC;
BEGIN
    IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive' USING ERRCODE = 'check_violation'; END IF;
    IF p_from = p_to THEN RAISE EXCEPTION 'cannot pay the same account'; END IF;

    INSERT INTO ledger_transaction (idempotency_key, kind, description, created_by)
    VALUES (p_idem, 'purchase', p_description, p_created_by)
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING txn_id INTO v_txn;
    IF v_txn IS NULL THEN
        SELECT txn_id INTO v_txn FROM ledger_transaction WHERE idempotency_key = p_idem;
        RETURN v_txn;  -- idempotent replay
    END IF;

    PERFORM 1 FROM account WHERE account_id = LEAST(p_from, p_to)    FOR UPDATE;
    PERFORM 1 FROM account WHERE account_id = GREATEST(p_from, p_to) FOR UPDATE;

    INSERT INTO ledger_entry (txn_id, account_id, currency, amount, txn_type) VALUES
        (v_txn, p_from, p_currency, -p_amount, 'purchase'),
        (v_txn, p_to,   p_currency,  p_amount, 'purchase');

    -- Loyalty accrual (weighted): floor(amount * rate) to the paying student.
    SELECT sw.student_id INTO v_student FROM student_wallet sw WHERE sw.account_id = p_from;
    IF v_student IS NOT NULL THEN
        SELECT rate INTO v_rate FROM loyalty_rule WHERE reason = 'purchase';
        v_points := floor(p_amount * COALESCE(v_rate, 0));
        IF v_points > 0 THEN
            INSERT INTO point_ledger (student_id, points, reason, source_txn_id)
            VALUES (v_student, v_points, 'purchase', v_txn);
        END IF;
    END IF;
    RETURN v_txn;
END; $$;

-- Recursion-safe round-up sweep. Fires ONLY on the payer's student spending-wallet
-- DEBIT leg of a purchase (depth guard + txn_type + amount<0), computes the spare
-- to the nearest step on abs(amount), and moves it into the locked savings wallet.
-- Skips silently if the student has insufficient headroom (never fails the purchase).
CREATE FUNCTION sweep_roundup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_student BIGINT; v_enabled BOOLEAN; v_step INT;
    v_spare NUMERIC(20,4); v_bal NUMERIC(20,4); v_savings BIGINT; v_txn BIGINT;
BEGIN
    SELECT sw.student_id INTO v_student
      FROM student_wallet sw
     WHERE sw.account_id = NEW.account_id AND sw.wallet_purpose = 'spending';
    IF v_student IS NULL THEN RETURN NULL; END IF;                 -- not a student spending wallet

    SELECT enabled, step INTO v_enabled, v_step FROM savings_config WHERE student_id = v_student;
    IF NOT COALESCE(v_enabled, false) THEN RETURN NULL; END IF;

    v_spare := ceil(abs(NEW.amount) / v_step) * v_step - abs(NEW.amount);   -- abs(): sign-safe
    IF v_spare <= 0 THEN RETURN NULL; END IF;

    SELECT balance INTO v_bal FROM account_balance
     WHERE account_id = NEW.account_id AND currency = NEW.currency;
    IF v_bal IS NULL OR v_bal < v_spare THEN RETURN NULL; END IF;  -- insufficient headroom -> skip

    -- Must match the purchase currency, else validate_leg_currency would RAISE and
    -- roll back the whole purchase. No matching-currency savings wallet -> skip.
    SELECT sw.account_id INTO v_savings
      FROM student_wallet sw
      JOIN account a ON a.account_id = sw.account_id
     WHERE sw.student_id = v_student AND sw.wallet_purpose = 'savings' AND a.currency = NEW.currency;
    IF v_savings IS NULL THEN RETURN NULL; END IF;

    INSERT INTO ledger_transaction (idempotency_key, kind, description)
        VALUES (gen_random_uuid(), 'roundup_sweep', 'round-up on txn ' || NEW.txn_id)
        RETURNING txn_id INTO v_txn;
    INSERT INTO ledger_entry (txn_id, account_id, currency, amount, txn_type) VALUES
        (v_txn, NEW.account_id, NEW.currency, -v_spare, 'roundup_sweep'),
        (v_txn, v_savings,      NEW.currency,  v_spare, 'roundup_sweep');
    RETURN NULL;
END; $$;

CREATE TRIGGER trg_roundup
    AFTER INSERT ON ledger_entry
    FOR EACH ROW
    WHEN (pg_trigger_depth() = 0 AND NEW.txn_type = 'purchase' AND NEW.amount < 0)  -- payer debit only, top-level
    EXECUTE FUNCTION sweep_roundup();

-- The Tuition Shield lock: reject debits from a savings wallet while locked.
CREATE FUNCTION lock_savings_withdrawal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_locked DATE;
BEGIN
    SELECT locked_until INTO v_locked FROM student_wallet
     WHERE account_id = NEW.account_id AND wallet_purpose = 'savings';
    IF v_locked IS NOT NULL AND now() < v_locked THEN
        RAISE EXCEPTION 'savings wallet % is locked until %', NEW.account_id, v_locked
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END; $$;

CREATE TRIGGER trg_savings_lock
    BEFORE INSERT ON ledger_entry
    FOR EACH ROW
    WHEN (NEW.amount < 0)   -- debits only; the round-up CREDIT into savings is never blocked
    EXECUTE FUNCTION lock_savings_withdrawal();

-- ═══ 4. Loyalty engine ══════════════════════════════════════════════════════
CREATE TABLE loyalty_rule (
    reason          TEXT PRIMARY KEY,
    rate            NUMERIC(10,4),   -- points earned per unit amount (accrual)
    conversion_rate NUMERIC(12,4)    -- points per 1 BDT (redemption)
);
INSERT INTO loyalty_rule (reason, rate, conversion_rate) VALUES
    ('purchase', 0.1, NULL),        -- 1 point per 10 BDT spent
    ('redeem',   NULL, 100.0);      -- 100 points = 1 BDT

-- Append-only points journal; the balance is a DERIVED SUM, never stored.
CREATE TABLE point_ledger (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id    BIGINT NOT NULL REFERENCES student(student_id),
    points        NUMERIC(20,4) NOT NULL CHECK (points <> 0),  -- +earned / -redeemed
    reason        TEXT NOT NULL,
    source_txn_id BIGINT REFERENCES ledger_transaction(txn_id),
    redeem_key    UUID UNIQUE,   -- idempotency for redemptions
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_point_student ON point_ledger (student_id) INCLUDE (points);

CREATE TRIGGER trg_point_immutable   BEFORE UPDATE OR DELETE ON point_ledger FOR EACH ROW       EXECUTE FUNCTION raise_append_only();
CREATE TRIGGER trg_point_no_truncate BEFORE TRUNCATE       ON point_ledger FOR EACH STATEMENT EXECUTE FUNCTION raise_append_only();

-- Derived point balance (never a stored mutable column).
CREATE VIEW v_point_balance AS
SELECT student_id, SUM(points) AS points FROM point_ledger GROUP BY student_id;

-- Atomic points -> BDT redemption. Serialized per student, idempotent, cannot go
-- negative, and posts a BALANCED BDT transfer from the loyalty_pool (no minting).
CREATE FUNCTION redeem_points(p_student BIGINT, p_points NUMERIC, p_idem UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing BIGINT; v_bal NUMERIC; v_conv NUMERIC; v_bdt NUMERIC(20,4); v_spend BIGINT; v_pool BIGINT;
BEGIN
    IF p_points <= 0 THEN RAISE EXCEPTION 'points must be positive' USING ERRCODE = 'check_violation'; END IF;
    IF p_points <> trunc(p_points) THEN   -- whole points only: keeps the 100:1 payout exact (no rounding gain)
        RAISE EXCEPTION 'points must be a whole number' USING ERRCODE = 'check_violation';
    END IF;

    PERFORM pg_advisory_xact_lock(p_student);   -- serialize FIRST, then check idempotency inside the lock

    SELECT id INTO v_existing FROM point_ledger WHERE redeem_key = p_idem;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;   -- idempotent replay

    SELECT COALESCE(SUM(points), 0) INTO v_bal FROM point_ledger WHERE student_id = p_student;
    IF v_bal < p_points THEN
        RAISE EXCEPTION 'insufficient points: have %, need %', v_bal, p_points USING ERRCODE = 'check_violation';
    END IF;

    SELECT conversion_rate INTO v_conv FROM loyalty_rule WHERE reason = 'redeem';
    v_bdt := round(p_points / v_conv, 2);
    IF v_bdt <= 0 THEN RAISE EXCEPTION 'redemption below the minimum payout' USING ERRCODE = 'check_violation'; END IF;

    SELECT account_id INTO v_spend FROM student_wallet WHERE student_id = p_student AND wallet_purpose = 'spending';
    SELECT account_id INTO v_pool  FROM system_account WHERE system_role = 'loyalty_pool';
    IF v_pool IS NULL THEN RAISE EXCEPTION 'no loyalty_pool account seeded'; END IF;

    INSERT INTO point_ledger (student_id, points, reason, redeem_key)
        VALUES (p_student, -p_points, 'redeem', p_idem) RETURNING id INTO v_existing;
    -- Fresh key for the internal transfer: reusing p_idem risks colliding with a
    -- prior transfer/purchase's idempotency_key, which would swallow the payout.
    PERFORM make_transfer(v_pool, v_spend, v_bdt, 'BDT', gen_random_uuid(), 'points redemption');
    RETURN v_existing;
END; $$;

-- Leaderboard: a materialized view with a window RANK(), refreshed by pg_cron.
CREATE MATERIALIZED VIEW mv_loyalty_leaderboard AS
SELECT pl.student_id,
       au.full_name,
       SUM(pl.points) AS points,
       RANK() OVER (ORDER BY SUM(pl.points) DESC) AS rank
FROM point_ledger pl
JOIN app_user au ON au.user_id = pl.student_id
GROUP BY pl.student_id, au.full_name;

CREATE UNIQUE INDEX ux_leaderboard_student ON mv_loyalty_leaderboard (student_id);  -- required for CONCURRENTLY

-- SECURITY DEFINER: REFRESH requires ownership of the matview (owned by the migration role).
CREATE FUNCTION refresh_leaderboard() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ REFRESH MATERIALIZED VIEW CONCURRENTLY mv_loyalty_leaderboard; $$;

-- ═══ 5. In-database scheduling (guarded: skipped where pg_cron is absent, e.g. CI) ═
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule('kyc-expiry',          '0 2 * * *', 'CALL expire_verifications()');
        PERFORM cron.schedule('alumni-downgrade',    '0 3 * * *', 'CALL downgrade_alumni()');
        PERFORM cron.schedule('leaderboard-refresh', '0 * * * *', 'SELECT refresh_leaderboard()');
    END IF;
END $$;

-- ═══ 6. Grants ══════════════════════════════════════════════════════════════
GRANT SELECT ON state_transition, kyc_verification, savings_config, loyalty_rule,
                point_ledger, v_kyc_effective, v_point_balance, mv_loyalty_leaderboard
    TO app_read, app_write, app_admin;

GRANT EXECUTE ON FUNCTION make_purchase(BIGINT,BIGINT,NUMERIC,CHAR,UUID,TEXT,BIGINT),
                          redeem_points(BIGINT,NUMERIC,UUID),
                          submit_kyc(BIGINT,TEXT,TEXT),
                          approve_kyc(BIGINT),
                          refresh_leaderboard()
    TO app_write, app_admin;

-- Down Migration

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Unschedule each existing job by id; raises nothing for absent names,
        -- so a partial/re-run teardown never orphans the remaining jobs.
        PERFORM cron.unschedule(jobid)
          FROM cron.job
         WHERE jobname IN ('kyc-expiry','alumni-downgrade','leaderboard-refresh');
    END IF;
END $$;

DROP FUNCTION IF EXISTS refresh_leaderboard();
DROP MATERIALIZED VIEW IF EXISTS mv_loyalty_leaderboard;
DROP FUNCTION IF EXISTS redeem_points(BIGINT, NUMERIC, UUID);
DROP VIEW IF EXISTS v_point_balance;
DROP TRIGGER IF EXISTS trg_point_no_truncate ON point_ledger;
DROP TRIGGER IF EXISTS trg_point_immutable   ON point_ledger;
DROP TABLE IF EXISTS point_ledger;
DROP TABLE IF EXISTS loyalty_rule;

DROP TRIGGER IF EXISTS trg_savings_lock ON ledger_entry;
DROP FUNCTION IF EXISTS lock_savings_withdrawal();
DROP TRIGGER IF EXISTS trg_roundup ON ledger_entry;
DROP FUNCTION IF EXISTS sweep_roundup();
DROP FUNCTION IF EXISTS make_purchase(BIGINT,BIGINT,NUMERIC,CHAR,UUID,TEXT,BIGINT);
DROP TABLE IF EXISTS savings_config;

DROP PROCEDURE IF EXISTS downgrade_alumni();
DROP PROCEDURE IF EXISTS expire_verifications();
DROP VIEW IF EXISTS v_kyc_effective;
DROP FUNCTION IF EXISTS approve_kyc(BIGINT);
DROP FUNCTION IF EXISTS submit_kyc(BIGINT, TEXT, TEXT);
DROP TRIGGER IF EXISTS trg_kyc_transition ON kyc_verification;
DROP TABLE IF EXISTS kyc_verification;
DROP FUNCTION IF EXISTS enforce_transition();
DROP TABLE IF EXISTS state_transition;
