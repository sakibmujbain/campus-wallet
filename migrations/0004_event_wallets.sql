-- ============================================================================
-- Migration 0004 — Dynamic Event Wallets & Defaulter List  (Phase 3)
-- The SET-OPERATION showcase: CR/club collection wallets with a live defaulter
-- list built via EXCEPT (roster minus fully-paid), correct under partial
-- payments and refunds, plus INTERSECT for cross-club overlap. Introduces the
-- pooled_wallet -> event_wallet arm of the account specialization hierarchy.
-- ============================================================================

-- Up Migration

-- ═══ Clubs (M:N membership — the source relation for INTERSECT/EXCEPT) ═══════
CREATE TABLE club (
    club_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE
);
CREATE TABLE club_member (
    club_id    BIGINT NOT NULL REFERENCES club(club_id),
    student_id BIGINT NOT NULL REFERENCES student(student_id),
    PRIMARY KEY (club_id, student_id)
);

-- ═══ Events, roster, and contributions ══════════════════════════════════════
CREATE TABLE event (
    event_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name              TEXT NOT NULL,
    batch             TEXT,
    organizer_user_id BIGINT REFERENCES app_user(user_id),
    club_id           BIGINT REFERENCES club(club_id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who is expected to pay, and how much — the MINUEND of the EXCEPT defaulter query.
CREATE TABLE event_roster (
    event_id        BIGINT NOT NULL REFERENCES event(event_id),
    student_id      BIGINT NOT NULL REFERENCES student(student_id),
    expected_amount NUMERIC(20,4) NOT NULL CHECK (expected_amount > 0),
    PRIMARY KEY (event_id, student_id)
);

-- Maps a ledger transaction to the event/student it paid (or refunded, if negative).
CREATE TABLE event_contribution (
    event_id   BIGINT NOT NULL REFERENCES event(event_id),
    student_id BIGINT NOT NULL REFERENCES student(student_id),
    txn_id     BIGINT NOT NULL REFERENCES ledger_transaction(txn_id),
    amount     NUMERIC(20,4) NOT NULL CHECK (amount <> 0),  -- +payment / -refund
    status     TEXT NOT NULL DEFAULT 'paid',
    PRIMARY KEY (event_id, txn_id)
);

-- ═══ pooled_wallet -> event_wallet (3rd arm of the specialization hierarchy) ═
CREATE TABLE pooled_wallet (
    account_id    BIGINT PRIMARY KEY,
    account_kind  TEXT GENERATED ALWAYS AS ('pooled') STORED,
    pool_kind     TEXT NOT NULL CHECK (pool_kind IN ('event','team')),
    owner_user_id BIGINT REFERENCES app_user(user_id),
    FOREIGN KEY (account_id, account_kind) REFERENCES account(account_id, account_kind),
    UNIQUE (account_id, pool_kind)
);

CREATE TABLE event_wallet (
    account_id BIGINT PRIMARY KEY,
    pool_kind  TEXT GENERATED ALWAYS AS ('event') STORED,
    event_id   BIGINT NOT NULL UNIQUE REFERENCES event(event_id),
    FOREIGN KEY (account_id, pool_kind) REFERENCES pooled_wallet(account_id, pool_kind)
);

-- Level-1 totality now recognizes 'pooled' (0002 raised "arrives in Phase 3").
-- CREATE OR REPLACE keeps the existing trg_account_totality trigger bound to it.
CREATE OR REPLACE FUNCTION assert_account_has_subtype() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    CASE NEW.account_kind
        WHEN 'student' THEN
            IF NOT EXISTS (SELECT 1 FROM student_wallet WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'account % (student) has no subtype row', NEW.account_id USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        WHEN 'institutional' THEN
            IF NOT EXISTS (SELECT 1 FROM institutional_wallet WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'account % (institutional) has no subtype row', NEW.account_id USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        WHEN 'system' THEN
            IF NOT EXISTS (SELECT 1 FROM system_account WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'account % (system) has no subtype row', NEW.account_id USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        WHEN 'pooled' THEN
            IF NOT EXISTS (SELECT 1 FROM pooled_wallet WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'account % (pooled) has no subtype row', NEW.account_id USING ERRCODE = 'integrity_constraint_violation';
            END IF;
    END CASE;
    RETURN NULL;
END; $$;

-- Level-2 totality: a pooled_wallet has exactly one of event/team.
CREATE FUNCTION assert_pool_has_subtype() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    CASE NEW.pool_kind
        WHEN 'event' THEN
            IF NOT EXISTS (SELECT 1 FROM event_wallet WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'pooled_wallet % (event) has no subtype row', NEW.account_id USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        WHEN 'team' THEN
            RAISE EXCEPTION 'team wallets arrive in Phase 5' USING ERRCODE = 'feature_not_supported';
    END CASE;
    RETURN NULL;
END; $$;

CREATE CONSTRAINT TRIGGER trg_pool_totality
    AFTER INSERT ON pooled_wallet
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_pool_has_subtype();

-- Subtype rows are delete-guarded (reuse the 0002 guard), like the other subtypes.
CREATE TRIGGER trg_no_del_pooled_wallet BEFORE DELETE ON pooled_wallet FOR EACH ROW EXECUTE FUNCTION forbid_subtype_delete();
CREATE TRIGGER trg_no_del_event_wallet  BEFORE DELETE ON event_wallet  FOR EACH ROW EXECUTE FUNCTION forbid_subtype_delete();

-- ═══ Functions: create an event (+ its pooled wallet), pay, refund ══════════
CREATE FUNCTION create_event(p_name TEXT, p_batch TEXT, p_organizer BIGINT, p_club BIGINT DEFAULT NULL, p_currency CHAR(3) DEFAULT 'BDT')
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event BIGINT; v_acct BIGINT;
BEGIN
    INSERT INTO event (name, batch, organizer_user_id, club_id)
        VALUES (p_name, p_batch, p_organizer, p_club) RETURNING event_id INTO v_event;
    INSERT INTO account (account_kind, currency) VALUES ('pooled', p_currency) RETURNING account_id INTO v_acct;
    INSERT INTO pooled_wallet (account_id, pool_kind, owner_user_id) VALUES (v_acct, 'event', p_organizer);
    INSERT INTO event_wallet (account_id, event_id) VALUES (v_acct, v_event);
    RETURN v_event;
END; $$;

-- A student pays into the event wallet; the contribution is recorded idempotently.
CREATE FUNCTION pay_event(p_student_account BIGINT, p_event BIGINT, p_amount NUMERIC, p_idem UUID, p_description TEXT DEFAULT NULL)
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
    -- Reject an idempotency key reused from an unrelated txn: the returned txn must
    -- actually credit THIS event's wallet (else make_transfer replayed a foreign txn).
    IF NOT EXISTS (SELECT 1 FROM ledger_entry WHERE txn_id = v_txn AND account_id = v_acct AND amount > 0) THEN
        RAISE EXCEPTION 'idempotency key % is not a payment into event %', p_idem, p_event USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO event_contribution (event_id, student_id, txn_id, amount)
        VALUES (p_event, v_student, v_txn, p_amount)
        ON CONFLICT (event_id, txn_id) DO NOTHING;   -- idempotent replay maps once
    RETURN v_txn;
END; $$;

-- Refund a contribution: reverses funds and records a NEGATIVE contribution, so
-- the student's paid-sum drops and they automatically REAPPEAR on the defaulter list.
CREATE FUNCTION refund_event(p_event BIGINT, p_student_account BIGINT, p_amount NUMERIC, p_idem UUID)
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

-- ═══ The SET-OPERATION showcase ═════════════════════════════════════════════
-- Real-time defaulter list: everyone on the roster EXCEPT those who have FULLY
-- paid. Correct under partial payments (they never enter fully_paid) and refunds
-- (a negative contribution drops their sum back below expected -> they reappear).
CREATE VIEW v_event_defaulters AS
WITH fully_paid AS (
    SELECT c.event_id, c.student_id
    FROM event_contribution c
    JOIN event_roster r ON r.event_id = c.event_id AND r.student_id = c.student_id
    GROUP BY c.event_id, c.student_id, r.expected_amount
    HAVING SUM(c.amount) >= r.expected_amount
),
defaulters AS (
    SELECT event_id, student_id FROM event_roster
    EXCEPT
    SELECT event_id, student_id FROM fully_paid
)
SELECT d.event_id,
       d.student_id,
       au.full_name,
       r.expected_amount,
       COALESCE(p.paid, 0)                    AS paid,
       r.expected_amount - COALESCE(p.paid, 0) AS outstanding
FROM defaulters d
JOIN event_roster r ON r.event_id = d.event_id AND r.student_id = d.student_id
JOIN student   s   ON s.student_id = d.student_id
JOIN app_user  au  ON au.user_id   = d.student_id
LEFT JOIN (
    SELECT event_id, student_id, SUM(amount) AS paid
    FROM event_contribution GROUP BY event_id, student_id
) p ON p.event_id = d.event_id AND p.student_id = d.student_id;

-- Cross-club overlap via INTERSECT (students in BOTH clubs).
CREATE FUNCTION club_overlap(p_club_a BIGINT, p_club_b BIGINT)
RETURNS TABLE (student_id BIGINT) LANGUAGE sql STABLE AS $$
    SELECT student_id FROM club_member WHERE club_id = p_club_a
    INTERSECT
    SELECT student_id FROM club_member WHERE club_id = p_club_b;
$$;

-- Live collection progress: aggregate + percent-of-target, ranked by a window fn.
-- `collected` is summed from event_contribution keyed on the EVENT alone, so it
-- counts every payment (a roster-join would silently drop off-roster contributions).
CREATE VIEW v_event_progress AS
SELECT e.event_id,
       e.name,
       e.batch,
       COALESCE(rs.roster_size, 0)                              AS roster_size,
       COALESCE(rs.target, 0)                                   AS target,
       COALESCE(cs.collected, 0)                                AS collected,
       round(100.0 * COALESCE(cs.collected, 0)
             / NULLIF(rs.target, 0), 1)                         AS pct_collected,
       RANK() OVER (ORDER BY COALESCE(cs.collected, 0) DESC)    AS collection_rank
FROM event e
LEFT JOIN (SELECT event_id, count(*) AS roster_size, SUM(expected_amount) AS target
             FROM event_roster GROUP BY event_id) rs ON rs.event_id = e.event_id
LEFT JOIN (SELECT event_id, SUM(amount) AS collected
             FROM event_contribution GROUP BY event_id) cs ON cs.event_id = e.event_id;

-- ═══ Grants ═════════════════════════════════════════════════════════════════
GRANT SELECT ON club, club_member, event, event_roster, event_contribution,
                pooled_wallet, event_wallet, v_event_defaulters, v_event_progress
    TO app_read, app_write, app_admin;

GRANT EXECUTE ON FUNCTION create_event(TEXT,TEXT,BIGINT,BIGINT,CHAR),
                          pay_event(BIGINT,BIGINT,NUMERIC,UUID,TEXT),
                          refund_event(BIGINT,BIGINT,NUMERIC,UUID)
    TO app_write, app_admin;
-- club_overlap is a pure read-only INTERSECT helper — grant it to app_read too.
GRANT EXECUTE ON FUNCTION club_overlap(BIGINT,BIGINT) TO app_read, app_write, app_admin;

-- Down Migration

DROP VIEW IF EXISTS v_event_progress;
DROP FUNCTION IF EXISTS club_overlap(BIGINT, BIGINT);
DROP VIEW IF EXISTS v_event_defaulters;
DROP FUNCTION IF EXISTS refund_event(BIGINT, BIGINT, NUMERIC, UUID);
DROP FUNCTION IF EXISTS pay_event(BIGINT, BIGINT, NUMERIC, UUID, TEXT);
DROP FUNCTION IF EXISTS create_event(TEXT, TEXT, BIGINT, BIGINT, CHAR);

DROP TRIGGER IF EXISTS trg_pool_totality ON pooled_wallet;
DROP FUNCTION IF EXISTS assert_pool_has_subtype();
-- NOTE: this down is schema-only. account rows with account_kind='pooled' created
-- by create_event survive (their ledger entries are immutable and FK-referenced, so
-- they can't be deleted here). Once events exist, run a FULL reset (down to 0001,
-- which drops the account table) rather than a standalone 0004 down — otherwise
-- those pooled accounts become subtype-less orphans on a later re-up.
DROP TABLE IF EXISTS event_wallet;    -- delete-guard triggers drop with the tables
DROP TABLE IF EXISTS pooled_wallet;

DROP TABLE IF EXISTS event_contribution;
DROP TABLE IF EXISTS event_roster;
DROP TABLE IF EXISTS event;
DROP TABLE IF EXISTS club_member;
DROP TABLE IF EXISTS club;

-- Restore the 0002 behavior: level-1 totality raises for 'pooled' again.
CREATE OR REPLACE FUNCTION assert_account_has_subtype() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    CASE NEW.account_kind
        WHEN 'student' THEN
            IF NOT EXISTS (SELECT 1 FROM student_wallet WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'account % (student) has no subtype row', NEW.account_id USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        WHEN 'institutional' THEN
            IF NOT EXISTS (SELECT 1 FROM institutional_wallet WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'account % (institutional) has no subtype row', NEW.account_id USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        WHEN 'system' THEN
            IF NOT EXISTS (SELECT 1 FROM system_account WHERE account_id = NEW.account_id) THEN
                RAISE EXCEPTION 'account % (system) has no subtype row', NEW.account_id USING ERRCODE = 'integrity_constraint_violation';
            END IF;
        WHEN 'pooled' THEN
            RAISE EXCEPTION 'pooled accounts arrive in Phase 3' USING ERRCODE = 'feature_not_supported';
    END CASE;
    RETURN NULL;
END; $$;
