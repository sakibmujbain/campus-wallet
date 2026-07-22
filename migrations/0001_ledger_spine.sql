-- ============================================================================
-- Migration 0001 — Ledger Spine  (Phase 0)
-- The immutable, append-only, double-entry ledger that every Campus Wallet
-- feature posts against. Balances are DERIVED (sum of legs); a per-currency
-- zero-sum invariant is enforced at COMMIT by a DEFERRABLE constraint trigger.
-- Money is exact NUMERIC — never float.
--
-- NOTE: `CREATE EXTENSION pg_cron;` is NOT here — on Supabase it is enabled once
-- from the dashboard (Database → Extensions) using the direct connection.
-- ============================================================================

-- Up Migration

-- ─── Reference: currencies (ISO-4217) ───────────────────────────────────────
CREATE TABLE currency (
    code       CHAR(3)  PRIMARY KEY,               -- 'BDT', 'USD'
    name       TEXT     NOT NULL,
    minor_unit SMALLINT NOT NULL CHECK (minor_unit BETWEEN 0 AND 4)
);
COMMENT ON TABLE currency IS 'ISO-4217 reference; minor_unit = rounding scale for settlement.';

INSERT INTO currency (code, name, minor_unit) VALUES
    ('BDT', 'Bangladeshi Taka', 2),
    ('USD', 'US Dollar',        2);

-- ─── Account: superclass of the wallet generalization hierarchy ──────────────
-- account_kind is the specialization discriminator. The composite UNIQUE below
-- lets Phase-1 subtype tables reference (account_id, account_kind) so an account
-- can never appear in two subtypes (declarative disjointness).
CREATE TABLE account (
    account_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_kind    TEXT    NOT NULL CHECK (account_kind IN ('student','institutional','pooled','system')),
    currency        CHAR(3) NOT NULL REFERENCES currency(code),
    -- Per-account overdraft floor. 0 for student wallets; a large negative value
    -- for system accounts (fx_bridge, escrow_holding, merchant, loyalty_pool)
    -- which legitimately hold negative positions. NEVER a schema-wide balance>=0.
    overdraft_floor NUMERIC(20,4) NOT NULL DEFAULT 0,
    status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, account_kind)   -- enables the disjoint composite FK in later migrations
);
COMMENT ON COLUMN account.overdraft_floor IS 'Lowest allowed balance; enforced by maintain_account_balance().';

-- ─── Ledger transaction: the immutable HEADER (one per business event) ───────
CREATE TABLE ledger_transaction (
    txn_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idempotency_key UUID NOT NULL UNIQUE,           -- exactly-once guard for money mutations
    kind            TEXT NOT NULL,                  -- 'transfer', 'fx_purchase', 'roundup_sweep', ...
    description     TEXT,
    created_by      BIGINT,                         -- app_user.user_id (FK added when users table lands)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Ledger entry: the immutable LEG (signed amount, one account, one currency)
CREATE TABLE ledger_entry (
    entry_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    txn_id     BIGINT   NOT NULL REFERENCES ledger_transaction(txn_id),
    account_id BIGINT   NOT NULL REFERENCES account(account_id),
    currency   CHAR(3)  NOT NULL REFERENCES currency(code),
    amount     NUMERIC(20,4) NOT NULL CHECK (amount <> 0),   -- signed: +credit / -debit
    direction  TEXT GENERATED ALWAYS AS (CASE WHEN amount > 0 THEN 'credit' ELSE 'debit' END) STORED,
    txn_type   TEXT NOT NULL,
    posted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_entry_account_time ON ledger_entry (account_id, posted_at DESC);
CREATE INDEX ix_entry_txn          ON ledger_entry (txn_id);

-- ─── Balance cache: trigger-maintained O(1) read (DECLARED denormalization) ──
-- The ledger stays authoritative; a nightly reconciliation (EXCEPT) proves the
-- cache equals SUM(ledger). See later migration for the reconcile job.
CREATE TABLE account_balance (
    account_id BIGINT  NOT NULL REFERENCES account(account_id),
    currency   CHAR(3) NOT NULL REFERENCES currency(code),
    balance    NUMERIC(20,4) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, currency)
);

-- ============================================================================
-- Triggers & functions — the invariants live in the database
-- ============================================================================

-- (a) A leg's currency must match its account's currency.
CREATE FUNCTION validate_leg_currency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.currency <> (SELECT currency FROM account WHERE account_id = NEW.account_id) THEN
        RAISE EXCEPTION 'leg currency % does not match account % currency', NEW.currency, NEW.account_id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_entry_currency
    BEFORE INSERT ON ledger_entry
    FOR EACH ROW EXECUTE FUNCTION validate_leg_currency();

-- (b) Maintain the O(1) balance cache AND enforce the per-account overdraft floor
--     on every insert path (transfers today, round-up sweeps / escrow later).
CREATE FUNCTION maintain_account_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_new_balance NUMERIC(20,4);
    v_floor       NUMERIC(20,4);
BEGIN
    INSERT INTO account_balance (account_id, currency, balance, updated_at)
    VALUES (NEW.account_id, NEW.currency, NEW.amount, now())
    ON CONFLICT (account_id, currency)
    DO UPDATE SET balance    = account_balance.balance + EXCLUDED.balance,
                  updated_at = now()
    RETURNING balance INTO v_new_balance;

    SELECT overdraft_floor INTO v_floor FROM account WHERE account_id = NEW.account_id;
    IF v_new_balance < v_floor THEN
        RAISE EXCEPTION 'account % would fall below its overdraft floor (% < %)',
            NEW.account_id, v_new_balance, v_floor
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_entry_balance
    AFTER INSERT ON ledger_entry
    FOR EACH ROW EXECUTE FUNCTION maintain_account_balance();

-- (c) DEFERRED per-currency zero-sum: every transaction must net to zero for
--     each currency, checked at COMMIT so multi-leg inserts are legal mid-txn.
--     A single non-zero leg cannot net to zero, so this also enforces "≥2 legs".
-- SECURITY DEFINER (owned by a BYPASSRLS role): this DEFERRED check fires at COMMIT
-- in the *session* role's context. If that role is RLS-subject (a restricted app
-- role), FORCE RLS on ledger_entry would hide the counterparty legs and the check
-- would false-fail on a valid transfer (or pass an RLS-hidden imbalance). Running as
-- the definer makes it see every leg regardless of who commits.
CREATE FUNCTION assert_txn_balanced() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM ledger_entry
        WHERE txn_id = NEW.txn_id
        GROUP BY currency
        HAVING SUM(amount) <> 0
    ) THEN
        RAISE EXCEPTION 'transaction % does not balance per currency', NEW.txn_id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_ledger_balanced
    AFTER INSERT ON ledger_entry
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_txn_balanced();

-- (c2) A transaction header must have at least one leg at COMMIT. Combined with
--      the per-currency zero-sum above, this closes the "empty header" hole:
--      a legs-less (and therefore unbalanced) transaction can never persist.
CREATE FUNCTION assert_txn_has_legs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$   -- see assert_txn_balanced note
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ledger_entry WHERE txn_id = NEW.txn_id) THEN
        RAISE EXCEPTION 'transaction % has no legs', NEW.txn_id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_txn_has_legs
    AFTER INSERT ON ledger_transaction
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_txn_has_legs();

-- (d) Immutability: the ledger is append-only. Corrections are compensating
--     reversal transactions, never edits. (Belt-and-suspenders with REVOKE.)
CREATE FUNCTION raise_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; post a compensating reversal instead of %',
        TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_entry_immutable
    BEFORE UPDATE OR DELETE ON ledger_entry
    FOR EACH ROW EXECUTE FUNCTION raise_append_only();

CREATE TRIGGER trg_txn_immutable
    BEFORE UPDATE OR DELETE ON ledger_transaction
    FOR EACH ROW EXECUTE FUNCTION raise_append_only();

-- TRUNCATE bypasses row-level UPDATE/DELETE triggers, so guard it explicitly
-- (statement-level) or the "immutable" ledger could be wiped in one command.
CREATE TRIGGER trg_entry_no_truncate
    BEFORE TRUNCATE ON ledger_entry
    FOR EACH STATEMENT EXECUTE FUNCTION raise_append_only();

CREATE TRIGGER trg_txn_no_truncate
    BEFORE TRUNCATE ON ledger_transaction
    FOR EACH STATEMENT EXECUTE FUNCTION raise_append_only();

-- ============================================================================
-- make_transfer() — the ONLY sanctioned path to move money between two accounts.
-- Idempotent, concurrency-safe (deterministic lock order), atomic.
-- ============================================================================
CREATE FUNCTION make_transfer(
    p_from        BIGINT,
    p_to          BIGINT,
    p_amount      NUMERIC,
    p_currency    CHAR(3),
    p_idem_key    UUID,
    p_description TEXT   DEFAULT NULL,
    p_created_by  BIGINT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_txn_id BIGINT;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'transfer amount must be positive, got %', p_amount
            USING ERRCODE = 'check_violation';
    END IF;
    IF p_from = p_to THEN
        RAISE EXCEPTION 'cannot transfer to the same account';
    END IF;

    -- Idempotency: replaying the same key returns the original txn without re-posting.
    INSERT INTO ledger_transaction (idempotency_key, kind, description, created_by)
    VALUES (p_idem_key, 'transfer', p_description, p_created_by)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING txn_id INTO v_txn_id;

    IF v_txn_id IS NULL THEN
        SELECT txn_id INTO v_txn_id FROM ledger_transaction WHERE idempotency_key = p_idem_key;
        RETURN v_txn_id;   -- already processed
    END IF;

    -- Lock both accounts in ascending id order to prevent deadlocks between
    -- concurrent transfers touching the same pair.
    PERFORM 1 FROM account WHERE account_id = LEAST(p_from, p_to)    FOR UPDATE;
    PERFORM 1 FROM account WHERE account_id = GREATEST(p_from, p_to) FOR UPDATE;

    -- Two balanced legs. The BEFORE trigger checks currency; the AFTER trigger
    -- updates the cache and enforces the overdraft floor on the debit leg; the
    -- deferred constraint trigger re-verifies zero-sum at COMMIT.
    INSERT INTO ledger_entry (txn_id, account_id, currency, amount, txn_type) VALUES
        (v_txn_id, p_from, p_currency, -p_amount, 'transfer'),
        (v_txn_id, p_to,   p_currency,  p_amount, 'transfer');

    RETURN v_txn_id;
END;
$$;

-- ============================================================================
-- DCL — least-privilege role model (a gradeable security artifact).
-- The app never UPDATEs/DELETEs ledger rows; money moves only via make_transfer.
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_read')  THEN CREATE ROLE app_read  NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_write') THEN CREATE ROLE app_write NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN CREATE ROLE app_admin NOLOGIN; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_read, app_write, app_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_read, app_write, app_admin;

-- app_write moves money ONLY through make_transfer() (SECURITY DEFINER); it holds
-- NO direct DML on the ledger or cache, so every mutation is funneled and audited.
-- (make_transfer runs as its bypassrls owner, so it writes the legs; the maintain
-- and deferred triggers run in that same definer context.)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ledger_transaction, ledger_entry FROM app_write, app_admin;
REVOKE INSERT, UPDATE, DELETE ON account_balance FROM app_write, app_admin;

-- Money movement funnels through the SECURITY DEFINER function.
GRANT EXECUTE ON FUNCTION make_transfer(BIGINT, BIGINT, NUMERIC, CHAR, UUID, TEXT, BIGINT) TO app_write, app_admin;

GRANT app_read  TO app_write;
GRANT app_write TO app_admin;

-- Convenience read view: accounts with their derived (cached) balance.
-- security_invoker so the caller's RLS on account_balance applies (a plain view
-- would run as its bypassrls owner and leak every balance past ab_owner).
CREATE VIEW v_account_balance WITH (security_invoker = true) AS
SELECT a.account_id,
       a.account_kind,
       a.currency,
       a.overdraft_floor,
       COALESCE(b.balance, 0) AS balance
FROM account a
LEFT JOIN account_balance b
       ON b.account_id = a.account_id AND b.currency = a.currency;

GRANT SELECT ON v_account_balance TO app_read, app_write, app_admin;

-- Down Migration

DROP VIEW IF EXISTS v_account_balance;

DROP FUNCTION IF EXISTS make_transfer(BIGINT, BIGINT, NUMERIC, CHAR, UUID, TEXT, BIGINT);

DROP TRIGGER IF EXISTS trg_txn_no_truncate   ON ledger_transaction;
DROP TRIGGER IF EXISTS trg_entry_no_truncate ON ledger_entry;
DROP TRIGGER IF EXISTS trg_txn_has_legs    ON ledger_transaction;
DROP TRIGGER IF EXISTS trg_txn_immutable   ON ledger_transaction;
DROP TRIGGER IF EXISTS trg_entry_immutable ON ledger_entry;
DROP TRIGGER IF EXISTS trg_ledger_balanced ON ledger_entry;
DROP TRIGGER IF EXISTS trg_entry_balance   ON ledger_entry;
DROP TRIGGER IF EXISTS trg_entry_currency  ON ledger_entry;

DROP FUNCTION IF EXISTS raise_append_only();
DROP FUNCTION IF EXISTS assert_txn_has_legs();
DROP FUNCTION IF EXISTS assert_txn_balanced();
DROP FUNCTION IF EXISTS maintain_account_balance();
DROP FUNCTION IF EXISTS validate_leg_currency();

DROP TABLE IF EXISTS account_balance;
DROP TABLE IF EXISTS ledger_entry;
DROP TABLE IF EXISTS ledger_transaction;
DROP TABLE IF EXISTS account;
DROP TABLE IF EXISTS currency;

-- Roles are cluster-level; drop only if unused. Reassign/skip errors are safe to ignore.
DO $$
BEGIN
    REVOKE ALL ON SCHEMA public FROM app_read, app_write, app_admin;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
