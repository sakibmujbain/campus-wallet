-- ============================================================================
-- showcase-queries.sql — one query per advanced SQL construct, each labelled
-- with the DBMS-rubric concept it demonstrates. Run against a seeded database
-- (npm run db:sql db/showcase-queries.sql prints nothing; run these in the
-- Supabase SQL editor / psql to see results). This is a gradeable artifact.
-- ============================================================================

-- ── SET OPERATION: EXCEPT ───────────────────────────────────────────────────
-- Real-time defaulter list: everyone on a roster who has NOT fully paid.
-- (The v_event_defaulters view wraps this and joins names/amounts.)
SELECT event_id, student_id FROM event_roster
EXCEPT
SELECT c.event_id, c.student_id
FROM event_contribution c
JOIN event_roster r ON r.event_id = c.event_id AND r.student_id = c.student_id
GROUP BY c.event_id, c.student_id, r.expected_amount
HAVING SUM(c.amount) >= r.expected_amount;

-- ── SET OPERATION: INTERSECT ────────────────────────────────────────────────
-- Students who belong to BOTH clubs (replace the ids). See club_overlap().
SELECT student_id FROM club_member WHERE club_id = 1
INTERSECT
SELECT student_id FROM club_member WHERE club_id = 2;

-- ── SET OPERATION: UNION (all campus payees, one list) ──────────────────────
SELECT 'student'::text AS kind, account_id FROM student_wallet
UNION
SELECT 'institutional', account_id FROM institutional_wallet
UNION
SELECT 'pooled', account_id FROM pooled_wallet
ORDER BY account_id;

-- ── WINDOW FUNCTION: running cumulative collection per event over time ───────
SELECT ec.event_id,
       ec.txn_id,
       lt.created_at,
       ec.amount,
       SUM(ec.amount) OVER (PARTITION BY ec.event_id ORDER BY lt.created_at
                            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
FROM event_contribution ec
JOIN ledger_transaction lt ON lt.txn_id = ec.txn_id
ORDER BY ec.event_id, lt.created_at;

-- ── WINDOW FUNCTION: RANK top contributors across all events ────────────────
SELECT au.full_name,
       SUM(ec.amount) AS total_contributed,
       RANK() OVER (ORDER BY SUM(ec.amount) DESC) AS rnk
FROM event_contribution ec
JOIN app_user au ON au.user_id = ec.student_id
GROUP BY au.full_name;

-- ── AGGREGATE + ROLLUP: collections by (batch, event) with subtotals ────────
SELECT e.batch,
       e.name AS event_name,
       SUM(ec.amount) AS collected
FROM event e
LEFT JOIN event_contribution ec ON ec.event_id = e.event_id
GROUP BY ROLLUP (e.batch, e.name)
ORDER BY e.batch NULLS LAST, event_name NULLS LAST;

-- ── LATERAL: each account with its most-recent ledger entry ─────────────────
SELECT a.account_id, a.account_kind, last.amount, last.posted_at
FROM account a
LEFT JOIN LATERAL (
    SELECT le.amount, le.posted_at
    FROM ledger_entry le
    WHERE le.account_id = a.account_id
    ORDER BY le.posted_at DESC
    LIMIT 1
) last ON true
ORDER BY a.account_id;

-- ── RECURSIVE CTE: a 14-day date spine for a collection burn-down ───────────
-- Generates every day in the window (even zero-collection days) then left-joins
-- daily totals — a genuine use (a plain GROUP BY would omit empty days).
WITH RECURSIVE days AS (
    SELECT (current_date - INTERVAL '13 days')::date AS day
    UNION ALL
    SELECT (day + INTERVAL '1 day')::date FROM days WHERE day < current_date
)
SELECT d.day, COALESCE(SUM(ec.amount), 0) AS collected
FROM days d
LEFT JOIN event_contribution ec
       ON ec.txn_id IN (SELECT txn_id FROM ledger_transaction WHERE created_at::date = d.day)
GROUP BY d.day
ORDER BY d.day;

-- ── CORRELATED SUBQUERY: events below 50% collected ─────────────────────────
SELECT name, batch
FROM event e
WHERE (SELECT COALESCE(SUM(ec.amount),0) FROM event_contribution ec WHERE ec.event_id = e.event_id)
    < 0.5 * (SELECT COALESCE(SUM(r.expected_amount),0) FROM event_roster r WHERE r.event_id = e.event_id);

-- ── SELF-AUDIT via set difference: cache vs ledger (should return 0 rows) ────
SELECT * FROM reconcile_balances();
