-- ============================================================================
-- Migration 0002 — Payment Hub  (Phase 1)
-- The EER centerpiece: a two-level, DISJOINT + TOTAL account specialization
-- hierarchy (declarative disjointness via discriminator-carrying composite FKs
-- + deferred totality triggers), plus Row-Level Security, a generic audit
-- trail, self-auditing balance reconciliation (EXCEPT), and the campus
-- payment hub that unifies exam / hall / cafeteria payees.
-- ============================================================================

-- Up Migration

-- ─── Identity & academic reference tables ───────────────────────────────────
CREATE TABLE app_user (
    user_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email      TEXT NOT NULL,
    full_name  TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'student'
               CHECK (role IN ('student','cr','club_exec','institution','admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_app_user_email ON app_user (lower(email));  -- case-insensitive uniqueness

CREATE TABLE hall (
    hall_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    provost_user_id BIGINT REFERENCES app_user(user_id)
);

CREATE TABLE student (
    student_id      BIGINT PRIMARY KEY REFERENCES app_user(user_id),  -- 1:1 with app_user
    student_no      TEXT NOT NULL UNIQUE,
    enrollment_date DATE NOT NULL,
    hall_id         BIGINT REFERENCES hall(hall_id),
    batch           TEXT
);

-- ============================================================================
-- Generalization / Specialization — two levels, disjoint + total.
--
--   account (superclass, from 0001)
--     ├── student_wallet        (spending | savings)
--     ├── institutional_wallet ──┬── hall_administration
--     │                          ├── exam_controller
--     │                          └── cafeteria_till
--     └── system_account         (treasury | fx_bridge | merchant | ...)
--
-- DISJOINTNESS is declarative (zero triggers): the parent has
-- UNIQUE(account_id, account_kind); each subtype pins account_kind as a
-- GENERATED constant and FKs the composite, so an account physically cannot
-- appear in two subtypes. TOTALITY (every account has exactly one subtype) is
-- enforced by DEFERRABLE constraint triggers checked at COMMIT.
-- ============================================================================

CREATE TABLE student_wallet (
    account_id     BIGINT PRIMARY KEY,
    account_kind   TEXT GENERATED ALWAYS AS ('student') STORED,
    student_id     BIGINT NOT NULL REFERENCES student(student_id),
    wallet_purpose TEXT NOT NULL CHECK (wallet_purpose IN ('spending','savings')),
    locked_until   DATE,
    FOREIGN KEY (account_id, account_kind) REFERENCES account(account_id, account_kind),
    UNIQUE (student_id, wallet_purpose)   -- one spending + one savings per student
);

CREATE TABLE institutional_wallet (
    account_id   BIGINT PRIMARY KEY,
    account_kind TEXT GENERATED ALWAYS AS ('institutional') STORED,
    inst_kind    TEXT NOT NULL CHECK (inst_kind IN ('hall','exam','cafeteria')),
    FOREIGN KEY (account_id, account_kind) REFERENCES account(account_id, account_kind),
    UNIQUE (account_id, inst_kind)        -- feeds the level-2 composite FK
);

CREATE TABLE hall_administration (
    account_id BIGINT PRIMARY KEY,
    inst_kind  TEXT GENERATED ALWAYS AS ('hall') STORED,
    hall_id    BIGINT NOT NULL REFERENCES hall(hall_id),
    FOREIGN KEY (account_id, inst_kind) REFERENCES institutional_wallet(account_id, inst_kind)
);

CREATE TABLE exam_controller (
    account_id BIGINT PRIMARY KEY,
    inst_kind  TEXT GENERATED ALWAYS AS ('exam') STORED,
    department TEXT NOT NULL,
    FOREIGN KEY (account_id, inst_kind) REFERENCES institutional_wallet(account_id, inst_kind)
);

CREATE TABLE cafeteria_till (
    account_id    BIGINT PRIMARY KEY,
    inst_kind     TEXT GENERATED ALWAYS AS ('cafeteria') STORED,
    till_location TEXT NOT NULL,
    iot_device_id TEXT,
    FOREIGN KEY (account_id, inst_kind) REFERENCES institutional_wallet(account_id, inst_kind)
);

CREATE TABLE system_account (
    account_id   BIGINT PRIMARY KEY,
    account_kind TEXT GENERATED ALWAYS AS ('system') STORED,
    system_role  TEXT NOT NULL
                 CHECK (system_role IN ('treasury','fx_bridge','fx_fee','escrow_holding','merchant','loyalty_pool','external')),
    FOREIGN KEY (account_id, account_kind) REFERENCES account(account_id, account_kind)
);

-- ─── TOTALITY: every account has exactly one subtype (deferred to COMMIT) ────
-- SECURITY DEFINER: this deferred totality check reads the subtype tables (which
-- are under FORCE RLS) at COMMIT in the committer's context. As the bypassrls
-- definer it always sees the just-inserted subtype row, so admin-created wallets
-- (GUC != owner) don't false-fail "has no subtype".
CREATE FUNCTION assert_account_has_subtype() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    CASE NEW.account_kind
        WHEN 'student' THEN
            IF NOT EXISTS (SELECT 1 FROM student_wallet WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'account % (student) has no subtype row', NEW.account_id
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        WHEN 'institutional' THEN
            IF NOT EXISTS (SELECT 1 FROM institutional_wallet WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'account % (institutional) has no subtype row', NEW.account_id
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        WHEN 'system' THEN
            IF NOT EXISTS (SELECT 1 FROM system_account WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'account % (system) has no subtype row', NEW.account_id
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        WHEN 'pooled' THEN
            RAISE EXCEPTION 'pooled accounts arrive in Phase 3'
                USING ERRCODE = 'feature_not_supported';
    END CASE;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_account_totality
    AFTER INSERT ON account
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_account_has_subtype();

-- Level-2 totality: an institutional_wallet has exactly one of hall/exam/cafeteria.
CREATE FUNCTION assert_inst_has_subtype() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$   -- see assert_account_has_subtype note
BEGIN
    CASE NEW.inst_kind
        WHEN 'hall' THEN
            IF NOT EXISTS (SELECT 1 FROM hall_administration WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'institutional_wallet % (hall) has no subtype row', NEW.account_id
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        WHEN 'exam' THEN
            IF NOT EXISTS (SELECT 1 FROM exam_controller WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'institutional_wallet % (exam) has no subtype row', NEW.account_id
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        WHEN 'cafeteria' THEN
            IF NOT EXISTS (SELECT 1 FROM cafeteria_till WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'institutional_wallet % (cafeteria) has no subtype row', NEW.account_id
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
    END CASE;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_inst_totality
    AFTER INSERT ON institutional_wallet
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_inst_has_subtype();

-- Guard TOTAL specialization against DELETE. The FK points subtype -> parent, so
-- deleting the PARENT is blocked, but deleting the sole CHILD would orphan the
-- account (kind set, no subtype). Forbid it — an account is retired via
-- account.status, never by deleting its subtype row.
CREATE FUNCTION forbid_subtype_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'cannot delete % for account % — retire the account via status, not by deleting its subtype',
        TG_TABLE_NAME, OLD.account_id
        USING ERRCODE = 'restrict_violation';
END; $$;

CREATE TRIGGER trg_no_del_student_wallet       BEFORE DELETE ON student_wallet       FOR EACH ROW EXECUTE FUNCTION forbid_subtype_delete();
CREATE TRIGGER trg_no_del_institutional_wallet BEFORE DELETE ON institutional_wallet FOR EACH ROW EXECUTE FUNCTION forbid_subtype_delete();
CREATE TRIGGER trg_no_del_hall_administration  BEFORE DELETE ON hall_administration  FOR EACH ROW EXECUTE FUNCTION forbid_subtype_delete();
CREATE TRIGGER trg_no_del_exam_controller      BEFORE DELETE ON exam_controller      FOR EACH ROW EXECUTE FUNCTION forbid_subtype_delete();
CREATE TRIGGER trg_no_del_cafeteria_till       BEFORE DELETE ON cafeteria_till       FOR EACH ROW EXECUTE FUNCTION forbid_subtype_delete();
CREATE TRIGGER trg_no_del_system_account       BEFORE DELETE ON system_account       FOR EACH ROW EXECUTE FUNCTION forbid_subtype_delete();

-- ============================================================================
-- open_* helpers — atomically create an account + its subtype row(s).
-- Because totality is DEFERRED, the parent and child inserts inside one call
-- both exist by COMMIT. These encapsulate the hierarchy for the seed and app.
-- ============================================================================
CREATE FUNCTION open_system_account(p_role TEXT, p_currency CHAR(3) DEFAULT 'BDT', p_floor NUMERIC DEFAULT 0)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
    INSERT INTO account (account_kind, currency, overdraft_floor)
        VALUES ('system', p_currency, p_floor) RETURNING account_id INTO v_id;
    INSERT INTO system_account (account_id, system_role) VALUES (v_id, p_role);
    RETURN v_id;
END; $$;

CREATE FUNCTION open_student_wallet(p_student BIGINT, p_purpose TEXT, p_currency CHAR(3) DEFAULT 'BDT')
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
    INSERT INTO account (account_kind, currency) VALUES ('student', p_currency) RETURNING account_id INTO v_id;
    INSERT INTO student_wallet (account_id, student_id, wallet_purpose) VALUES (v_id, p_student, p_purpose);
    RETURN v_id;
END; $$;

CREATE FUNCTION open_hall_wallet(p_hall BIGINT, p_currency CHAR(3) DEFAULT 'BDT')
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
    INSERT INTO account (account_kind, currency) VALUES ('institutional', p_currency) RETURNING account_id INTO v_id;
    INSERT INTO institutional_wallet (account_id, inst_kind) VALUES (v_id, 'hall');
    INSERT INTO hall_administration (account_id, hall_id) VALUES (v_id, p_hall);
    RETURN v_id;
END; $$;

CREATE FUNCTION open_exam_wallet(p_department TEXT, p_currency CHAR(3) DEFAULT 'BDT')
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
    INSERT INTO account (account_kind, currency) VALUES ('institutional', p_currency) RETURNING account_id INTO v_id;
    INSERT INTO institutional_wallet (account_id, inst_kind) VALUES (v_id, 'exam');
    INSERT INTO exam_controller (account_id, department) VALUES (v_id, p_department);
    RETURN v_id;
END; $$;

CREATE FUNCTION open_cafeteria_wallet(p_location TEXT, p_device TEXT DEFAULT NULL, p_currency CHAR(3) DEFAULT 'BDT')
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
    INSERT INTO account (account_kind, currency) VALUES ('institutional', p_currency) RETURNING account_id INTO v_id;
    INSERT INTO institutional_wallet (account_id, inst_kind) VALUES (v_id, 'cafeteria');
    INSERT INTO cafeteria_till (account_id, till_location, iot_device_id) VALUES (v_id, p_location, p_device);
    RETURN v_id;
END; $$;

-- ============================================================================
-- Generic audit trail — one to_jsonb() trigger over the mutable tables.
-- (The ledger is immutable/append-only, so it is NOT audited here — that would
-- double storage on the largest tables; its history IS the audit.)
-- ============================================================================
CREATE TABLE audit_log (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name TEXT NOT NULL,
    op         TEXT NOT NULL,
    row_before JSONB,
    row_after  JSONB,
    changed_by BIGINT,                     -- app user id from the GUC; populated once auth threads it (Phase 2)
    actor_role TEXT NOT NULL,              -- DB role that made the change (always known) — attribution even pre-auth
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SECURITY DEFINER so the trigger can always INSERT into audit_log regardless of
-- which (possibly restricted) role mutated the audited table.
CREATE FUNCTION audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO audit_log (table_name, op, row_before, row_after, changed_by, actor_role)
    VALUES (
        TG_TABLE_NAME,
        TG_OP,
        CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
        NULLIF(current_setting('app.current_user_id', true), '')::BIGINT,
        current_user
    );
    RETURN NULL;
END; $$;

CREATE TRIGGER trg_audit_account          AFTER INSERT OR UPDATE OR DELETE ON account              FOR EACH ROW EXECUTE FUNCTION audit();
CREATE TRIGGER trg_audit_app_user         AFTER INSERT OR UPDATE OR DELETE ON app_user             FOR EACH ROW EXECUTE FUNCTION audit();
CREATE TRIGGER trg_audit_student          AFTER INSERT OR UPDATE OR DELETE ON student              FOR EACH ROW EXECUTE FUNCTION audit();
CREATE TRIGGER trg_audit_student_wallet   AFTER INSERT OR UPDATE OR DELETE ON student_wallet       FOR EACH ROW EXECUTE FUNCTION audit();
CREATE TRIGGER trg_audit_inst_wallet      AFTER INSERT OR UPDATE OR DELETE ON institutional_wallet FOR EACH ROW EXECUTE FUNCTION audit();

-- audit_log is itself append-only (reuse the 0001 immutability guard).
CREATE TRIGGER trg_audit_immutable     BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW       EXECUTE FUNCTION raise_append_only();
CREATE TRIGGER trg_audit_no_truncate   BEFORE TRUNCATE       ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION raise_append_only();

-- ============================================================================
-- Row-Level Security — each student sees only their own wallets & ledger.
-- Keyed to the app.current_user_id GUC (set per-transaction via SET LOCAL).
-- NOTE: the Supabase 'postgres' role is a superuser and BYPASSES RLS, so the
-- app keeps working; enforcement is demonstrated by SET ROLE app_write in the
-- smoke test (a non-superuser role to which RLS actually applies).
-- ============================================================================
CREATE FUNCTION app_current_user() RETURNS BIGINT
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::BIGINT;
$$;

ALTER TABLE student_wallet  ENABLE ROW LEVEL SECURITY;  ALTER TABLE student_wallet  FORCE ROW LEVEL SECURITY;
ALTER TABLE account_balance ENABLE ROW LEVEL SECURITY;  ALTER TABLE account_balance FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_entry    ENABLE ROW LEVEL SECURITY;  ALTER TABLE ledger_entry    FORCE ROW LEVEL SECURITY;

-- A student's own wallet accounts.
CREATE POLICY sw_owner ON student_wallet
    FOR SELECT USING (student_id = app_current_user());

-- Balances/ledger rows for accounts the current user owns.
CREATE POLICY ab_owner ON account_balance
    FOR SELECT USING (account_id IN (SELECT account_id FROM student_wallet WHERE student_id = app_current_user()));

CREATE POLICY le_owner ON ledger_entry
    FOR SELECT USING (account_id IN (SELECT account_id FROM student_wallet WHERE student_id = app_current_user()));

-- ============================================================================
-- Self-auditing reconciliation — the cache must equal SUM(ledger) at all times.
-- Uses EXCEPT: any returned row is drift. (Healthy system => zero rows.)
-- ============================================================================
-- SECURITY DEFINER so it always sees the FULL ledger (not an RLS-filtered slice if
-- ever called by a restricted role). FULL OUTER JOIN makes the drift check SYMMETRIC:
-- a plain `cache EXCEPT ledger` misses groups that exist in the ledger but have no
-- cache row. Healthy system => zero rows.
CREATE FUNCTION reconcile_balances()
RETURNS TABLE (account_id BIGINT, currency CHAR(3), cached NUMERIC, ledger NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(b.account_id, l.account_id),
           COALESCE(b.currency,   l.currency),
           b.balance,
           l.total
    FROM account_balance b
    FULL OUTER JOIN (
        SELECT account_id, currency, SUM(amount) AS total
        FROM ledger_entry GROUP BY account_id, currency
    ) l ON l.account_id = b.account_id AND l.currency = b.currency
    WHERE b.balance IS DISTINCT FROM l.total;
$$;

-- ============================================================================
-- Payment hub — one unified list of payable campus targets across subtypes.
-- ============================================================================
CREATE VIEW v_payable_targets AS
SELECT iw.account_id,
       a.currency,
       iw.inst_kind,
       CASE iw.inst_kind
           WHEN 'hall'      THEN 'Hall dues — '   || h.name
           WHEN 'exam'      THEN 'Exam fees — '   || ec.department
           WHEN 'cafeteria' THEN 'Cafeteria — '   || ct.till_location
       END AS label
FROM institutional_wallet iw
JOIN account a                 ON a.account_id  = iw.account_id
LEFT JOIN hall_administration ha ON ha.account_id = iw.account_id
LEFT JOIN hall h                 ON h.hall_id     = ha.hall_id
LEFT JOIN exam_controller ec     ON ec.account_id = iw.account_id
LEFT JOIN cafeteria_till ct      ON ct.account_id = iw.account_id;

-- ─── Grants for the new tables/objects (RLS still governs row visibility) ────
GRANT SELECT ON app_user, student, hall,
                student_wallet, institutional_wallet, hall_administration,
                exam_controller, cafeteria_till, system_account,
                v_payable_targets
    TO app_read, app_write, app_admin;

-- audit_log holds copies of RLS-protected wallet rows + PII (emails, names), so it
-- is a potential side-channel around wallet RLS — restrict to admin only.
GRANT SELECT ON audit_log TO app_admin;

GRANT EXECUTE ON FUNCTION app_current_user(), reconcile_balances() TO app_read, app_write, app_admin;

-- RLS enforcement is demonstrated by SET ROLE into a NON-bypass role:
--   • vanilla Postgres / CI: the superuser `postgres` can assume `app_write` directly.
--   • Supabase: `postgres` bypasses RLS and can't assume `app_write`, but it CAN
--     assume the built-in `authenticated` role — so expose the RLS-governed tables
--     to it. Guarded so it's a no-op on a database without that role.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT ON student_wallet, account_balance, ledger_entry TO authenticated;
    END IF;
END $$;

-- Down Migration

DROP VIEW IF EXISTS v_payable_targets;
DROP FUNCTION IF EXISTS reconcile_balances();

DROP POLICY IF EXISTS le_owner ON ledger_entry;
DROP POLICY IF EXISTS ab_owner ON account_balance;
DROP POLICY IF EXISTS sw_owner ON student_wallet;
ALTER TABLE IF EXISTS ledger_entry    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ledger_entry    DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS account_balance NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS account_balance DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS student_wallet  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS student_wallet  DISABLE ROW LEVEL SECURITY;
DROP FUNCTION IF EXISTS app_current_user();

DROP TRIGGER IF EXISTS trg_audit_no_truncate ON audit_log;
DROP TRIGGER IF EXISTS trg_audit_immutable   ON audit_log;
DROP TRIGGER IF EXISTS trg_audit_inst_wallet    ON institutional_wallet;
DROP TRIGGER IF EXISTS trg_audit_student_wallet ON student_wallet;
DROP TRIGGER IF EXISTS trg_audit_student        ON student;
DROP TRIGGER IF EXISTS trg_audit_app_user       ON app_user;
DROP TRIGGER IF EXISTS trg_audit_account        ON account;
DROP FUNCTION IF EXISTS audit();
DROP TABLE IF EXISTS audit_log;

DROP FUNCTION IF EXISTS open_cafeteria_wallet(TEXT, TEXT, CHAR);
DROP FUNCTION IF EXISTS open_exam_wallet(TEXT, CHAR);
DROP FUNCTION IF EXISTS open_hall_wallet(BIGINT, CHAR);
DROP FUNCTION IF EXISTS open_student_wallet(BIGINT, TEXT, CHAR);
DROP FUNCTION IF EXISTS open_system_account(TEXT, CHAR, NUMERIC);

DROP TRIGGER IF EXISTS trg_inst_totality    ON institutional_wallet;
DROP TRIGGER IF EXISTS trg_account_totality ON account;
DROP FUNCTION IF EXISTS assert_inst_has_subtype();
DROP FUNCTION IF EXISTS assert_account_has_subtype();
-- CASCADE: its BEFORE DELETE triggers on the subtype tables depend on it.
DROP FUNCTION IF EXISTS forbid_subtype_delete() CASCADE;

DROP TABLE IF EXISTS system_account;
DROP TABLE IF EXISTS cafeteria_till;
DROP TABLE IF EXISTS exam_controller;
DROP TABLE IF EXISTS hall_administration;
DROP TABLE IF EXISTS institutional_wallet;
DROP TABLE IF EXISTS student_wallet;
DROP TABLE IF EXISTS student;
DROP TABLE IF EXISTS hall;
DROP TABLE IF EXISTS app_user;
