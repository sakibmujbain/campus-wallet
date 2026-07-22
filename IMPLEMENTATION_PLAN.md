# Campus Wallet — Implementation Plan
### A student FinTech platform, engineered as a top-marks PostgreSQL DBMS course project

> **Thesis:** *Thin app, smart database.* Every money-moving invariant lives in PostgreSQL — the Next.js app only orchestrates and presents. The whole system is one **immutable, append-only, double-entry ledger**; all eight features are expressed as balanced postings against it. This is what separates an A+ from an A in a course that grades *database design*, not app polish.

---

## 0. Executive summary

| | |
|---|---|
| **What** | Campus Wallet — student e-KYC, campus payment hub, event wallets, multi-sig team wallets, round-up savings, loyalty points, multi-currency FX bridge, peer escrow marketplace. |
| **DBMS** | PostgreSQL (the star of the grade). |
| **Stack** | Next.js (App Router) + TypeScript, **raw SQL via `node-postgres`** (no ORM hiding the SQL), installable PWA. |
| **Deploy** | 100% free tier: **Supabase** (Postgres + `pg_cron` + Auth + Storage) + **Vercel Hobby** + **GitHub Actions** (CI, keep-alive). |
| **Team** | 2–3 people. |
| **Timeline** | ~13–14 focused weeks for the *full* build; **Phases 0–3 are the guaranteed gradeable core**, Phases 4–5 are droppable bonus, Phase 6 (design artifacts) is non-negotiable. |
| **Stand-out move** | Cause a real concurrency anomaly on screen, then prove `FOR UPDATE` / `SERIALIZABLE`-retry eliminates it. Graders reward *"we caused and then prevented the bug"* far more than *"we used FOR UPDATE."* |

---

## 1. Locked decisions (confirmed with you)

- **PostgreSQL** — supports every "database flex" natively.
- **Next.js + TypeScript full-stack, raw SQL** (`pg`), typed at compile time with **pgTyped** (SQL stays the source of truth), `zod` only at HTTP/FX-API trust boundaries.
- **Responsive PWA** (installable, mobile-first).
- **Full ambitious scope**, deployed entirely on **free tiers**.
- **Team of 2–3.**

---

## 2. Architecture thesis — "Thin app, smart database"

The single most important design choice: **push every financial invariant into the database.**

- One **immutable append-only double-entry ledger** is the *only* source of financial truth. One `ledger_transaction` header + ≥2 signed `ledger_entry` legs that **net to zero per currency**, verified at `COMMIT` by a **`DEFERRABLE INITIALLY DEFERRED` constraint trigger**.
- **Balances are derived** (`SUM` of legs), never a mutable "authoritative" column. A trigger-maintained cache exists only as a *reconcilable* performance optimization.
- **Money is exact `NUMERIC`** — never `float`, never the `money` type.
- Corrections are **compensating reversal transactions**, never `UPDATE`/`DELETE` (enforced by `REVOKE` + a `BEFORE UPDATE/DELETE` trigger).
- All writes funnel through **`SECURITY DEFINER` procedures**; direct table writes are revoked from the app role.

Why this wins marks: it produces a *coherent* schema where every one of the eight features reuses the same spine, and every advanced DB concept (deferred integrity, triggers, procedures, concurrency control, RLS, set operations) falls out naturally instead of being bolted on.

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Database | **PostgreSQL** (stock, on Supabase) | Raw SQL, PL/pgSQL, deferred constraint triggers, RLS, `pg_cron`, `EXCEPT`/`INTERSECT`, `NUMERIC`. |
| App | **Next.js (App Router) + TypeScript**, PWA | One language end-to-end; installable; first-party on Vercel. |
| DB driver | **`node-postgres` (pg)** via Supabase **Supavisor transaction-mode pooler** (port 6543), module-scoped `Pool` max 1–3 | Prevents serverless connection exhaustion (~60-conn cap). |
| Typed SQL | **pgTyped** (types generated from literal `.sql` files) | Compile-time types **without an ORM** — SQL stays the source of truth. |
| Migrations | **node-pg-migrate** (numbered up/down raw SQL) | Every trigger/function/RLS policy is version-controlled raw SQL. |
| Auth | **Supabase Auth** (email verification for `.edu.bd`; JWT role claim) | Drives e-KYC email path + role-based access. |
| File storage | **Supabase Storage** private `kyc-docs` bucket (RLS) | ID-card uploads; DB stores only the object key + SHA-256 hash + issues signed URLs. Overflow → Cloudflare R2. |
| Scheduler | **`pg_cron`** (in-DB) + **GitHub Actions** cron (keep-alive + host-independent fallback) | "The database schedules itself"; escrow release, alumni downgrade, matview refresh. |
| Testing | **pgTAP** + `pg_prove` in GitHub Actions | Database unit tests for every invariant. |
| Money types | **`NUMERIC(20,4)`** amounts, **`NUMERIC(24,12)`** FX rates, `NUMERIC(20,4)` points | Exact; never float. |

---

## 4. Free-tier deployment architecture

```
┌──────────────┐   HTTPS    ┌───────────────────────┐   6543 (pooler, tx-mode)   ┌────────────────────────┐
│  Browser/PWA │──────────▶ │  Vercel Hobby         │──────────────────────────▶ │  Supabase Postgres     │
│ (installable)│            │  Next.js App Router   │                             │  + pg_cron (in-DB jobs)│
└──────────────┘            │  API routes / actions │   5432 (direct, migrations) │  + Auth + Storage      │
                            └───────────────────────┘                             └────────────────────────┘
                                     ▲                                                      ▲
                                     │  secured API route (fallback trigger)                │ CREATE EXTENSION,
                            ┌────────┴─────────┐                                            │ DDL, node-pg-migrate
                            │ GitHub Actions   │  keep-alive ping every ~3 days ────────────┘
                            │ cron + CI/pgTAP  │  + host-independent cron fallback
                            └──────────────────┘
```

**Why Supabase is the host:** it is the *only* free option that satisfies **every** requirement in one place — raw SQL + deferred/constraint triggers + PL/pgSQL procedures + **in-database scheduling (`pg_cron`)** + auth + private file storage. Free tier: 500 MB DB, 1 GB Storage, ~50k MAU Auth, 5 GB egress.

**Explicitly rejected:**
- **Neon** — no free `pg_cron`, scale-to-zero breaks in-DB cron (keep as a *migration-branching* demo only).
- **Render Postgres** — free DB **deleted after 30 days** (fatal mid-semester).
- **Fly.io / ElephantSQL** — free Postgres tiers gone in 2026.
- **CockroachDB Serverless** — not real Postgres (no `pg_cron`/PL/pgSQL).

**Host-independence insurance:** *all* scheduled logic lives inside **idempotent SQL functions**. `pg_cron` calls them today; if Supabase ever gates `pg_cron`, a GitHub Actions / Vercel cron hits a secured Next.js route that `CALL`s the *same* functions. The schedule changes; the logic never does.

### ⚠️ Free-tier gotchas (each has a mitigation baked into the plan)

1. **Supabase auto-pauses after ~7 days idle** and `pg_cron` does **not** run while paused → a paused DB fails the grading demo. **Mitigation:** GitHub Actions keep-alive ping every ~3 days. *Note:* GitHub also disables scheduled workflows after ~60 days of repo inactivity — commit periodically. **Rehearse a cold resume right before grading.**
2. **500 MB DB ceiling is real.** The generic audit trigger stores `to_jsonb(OLD)+to_jsonb(NEW)` on every sensitive write (~doubles row volume). **Mitigation:** scope auditing to truly sensitive tables; **seed → run EXPLAIN → truncate** the 200k/500k-row optimization dataset rather than keeping it resident.
3. **Transaction-mode pooler (6543) has no session state.** You **must** use `SET LOCAL` for the RLS identity GUC *inside an explicit transaction* (or identity leaks across pooled clients), and **disable named prepared statements** (or you hit *"prepared statement already exists"*). Reserve the direct 5432 string strictly for migrations/DDL/`CREATE EXTENSION`.
4. **`REFRESH MATERIALIZED VIEW CONCURRENTLY` errors without a `UNIQUE` index** on the matview — add it before scheduling.
5. **Vercel Hobby is non-commercial** and has a ~10 s function timeout — keep each money op to a single fast DB round trip (the "thin app" design already does this).
6. **Confirm Supabase free still ships `pg_cron` for your project/region in 2026** before betting on in-DB scheduling; if gated, promote the external scheduler from optional to primary.

---

## 5. Data model

### 5.1 The ledger spine (immutable, append-only, double-entry)

| Table | Role |
|---|---|
| `currency` | ISO-4217 reference (`code`, `name`, `minor_unit`); seed BDT=2, USD=2. |
| `fx_rate` | **Effective-dated, append-only** rate history — `PK(base, quote, valid_from)`; never updated, so every historical purchase is reproducible. |
| `ledger_transaction` | Immutable **header**: `idempotency_key UUID UNIQUE`, `kind`, frozen `exchange_rate NUMERIC(24,12)`, `rate_captured_at`, `created_by`, `created_at`. |
| `ledger_entry` | Immutable **leg**: `txn_id`, `account_id`, `currency`, `amount NUMERIC(20,4) CHECK(amount<>0)`, `direction` (GENERATED from sign), `base_amount_bdt`, `txn_type`, `posted_at`. Legs **sum to zero per currency per txn** (deferred trigger). |
| `account_balance` | Trigger-maintained **O(1) cache** (declared denormalization); ledger stays authoritative; reconciled nightly via `EXCEPT`. |
| `idempotency_request` | Exactly-once guard; stores prior response for safe replay; written in the *same* transaction as the legs. |

**Representative SQL — the zero-sum-per-currency deferred check (the schema's beating heart):**

```sql
CREATE FUNCTION assert_txn_balanced() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ledger_entry
    WHERE txn_id = NEW.txn_id
    GROUP BY currency
    HAVING SUM(amount) <> 0            -- each currency must independently net to zero
  ) THEN
    RAISE EXCEPTION 'Transaction % does not balance per currency', NEW.txn_id;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_txn_balanced
  AFTER INSERT ON ledger_entry
  DEFERRABLE INITIALLY DEFERRED           -- checked at COMMIT, so multi-leg inserts are legal mid-transaction
  FOR EACH ROW EXECUTE FUNCTION assert_txn_balanced();
```

**Immutability (belt + suspenders):**

```sql
REVOKE UPDATE, DELETE ON ledger_entry, ledger_transaction FROM app_write;
CREATE TRIGGER trg_append_only BEFORE UPDATE OR DELETE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION raise_append_only();  -- RAISE 'append-only; post a reversal'
```

### 5.2 Account generalization / specialization (the EER centerpiece)

Two-level, **disjoint + total** specialization, mapped **table-per-subtype** (class-table inheritance — *not* native `INHERITS`, which doesn't inherit PK/UNIQUE/FK).

```
                          account  (superclass: account_id, account_kind, currency, status, overdraft_floor)
                             │  disjoint 'd' + total
    ┌────────────────┬───────┴────────┬────────────────────┐
student_wallet  institutional_wallet  pooled_wallet     system_account
(spending|         │ disjoint+total    │ disjoint+total   (fx_bridge, fx_fee,
 savings)   ┌──────┼───────┐    ┌──────┴──────┐            escrow_holding,
        hall_    exam_    cafeteria_  event_   team_        merchant, external,
        admin    controller  till     wallet   wallet       loyalty_pool)
```

**Disjointness — declarative, ZERO triggers.** The parent carries `UNIQUE(account_id, account_kind)`; each subtype has `account_kind` as a `GENERATED ALWAYS AS ('<its kind>') STORED` constant and FKs the composite:

```sql
CREATE TABLE account (
  account_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_kind    TEXT NOT NULL CHECK (account_kind IN ('student','institutional','pooled','system')),
  currency        CHAR(3) NOT NULL REFERENCES currency(code),
  overdraft_floor NUMERIC(20,4) NOT NULL DEFAULT 0,   -- see fix #2 below
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, account_kind)                   -- enables the disjoint composite FK
);

CREATE TABLE student_wallet (
  account_id     BIGINT PRIMARY KEY,
  account_kind   TEXT GENERATED ALWAYS AS ('student') STORED,
  student_id     BIGINT NOT NULL REFERENCES student(student_id),
  wallet_purpose TEXT NOT NULL CHECK (wallet_purpose IN ('spending','savings')),
  locked_until   DATE,
  FOREIGN KEY (account_id, account_kind) REFERENCES account(account_id, account_kind),
  UNIQUE (student_id, wallet_purpose)
);
```

Because `account_id` is the subtype PK (unique) and each subtype pins a *different constant* kind, an account **physically cannot** appear in two subtype tables. **Totality** (every account has exactly one subtype) is enforced by a `DEFERRABLE INITIALLY DEFERRED` constraint trigger at `COMMIT`, so parent + subtype can be inserted in the same transaction.

### 5.3 Feature tables (by feature)

- **e-KYC (1):** `kyc_verification` (state machine, `method`, `alumni_at` GENERATED from **`student.enrollment_date`** — see fix #7), partial-unique index for one active KYC. `state_transition` = data-driven legal-transition graph shared by KYC/escrow/multi-sig.
- **FX bridge (2):** `fx_rate` history + frozen `exchange_rate` on the txn; `system_account` roles `fx_bridge`/`fx_fee`/`merchant`.
- **Payment hub (3):** the subtype hierarchy above; `hall`, `student`, `v_payable_targets` view.
- **Event wallets (4):** `event`, `event_roster` (expected amount), `event_contribution` (maps txn→student), `club`/`club_member` (M:N, source of `INTERSECT`).
- **Multi-sig (5):** `team_wallet(threshold)`, `wallet_approver` (M:N), `pending_transfer` (frozen `required_threshold` + `approver_snapshot`), `transfer_approval` (`PK(transfer_id, approver_user_id)` — no double-sign).
- **Round-up (6):** `savings_config` (`step ∈ {10,50}`, `locked_until`); sweeps into the `savings` student wallet.
- **Loyalty (7):** `loyalty_rule`, append-only `point_ledger` (balance = `SUM`), `mv_loyalty_leaderboard` (`RANK()`).
- **Escrow (8):** `escrow` (state machine, mutable `release_deadline` — see fix #5), funds held in `escrow_holding` system account.
- **Cross-cutting:** `audit_log` (generic `to_jsonb` trigger), `balance_snapshot` *(demoted to "future work" — see fix #9)*.

### 5.4 Corrected design decisions — the 7 bugs the adversarial review caught (all fixed here)

| # | Bug (first-pass design) | Fix (in this plan) | Severity |
|---|---|---|---|
| 1 | **KYC enum casing mismatch** — partial index used `'pending'/'verified'` but procedures used `'Verified'/'Expired'`; enum labels are case-sensitive, so "one active KYC" **silently never enforced**. | One canonical **lowercase** casing everywhere (enum, partial index, `state_transition`, cron). pgTAP test: 2nd active KYC must fail. | 🔴 critical |
| 2 | **Global `balance >= 0`** — mathematically breaks the FX bridge (bridge holds a *negative* USD position by construction), plus escrow/merchant legs. `overdraft_floor` was referenced but never modeled. | Per-account **`overdraft_floor` column**; `CHECK(balance >= overdraft_floor)`. `0` for student wallets, effectively unbounded-negative for `fx_bridge`/`escrow_holding`/`merchant`/`loyalty_pool`. Never a schema-wide `>= 0`. | 🔴 critical |
| 3 | **Generic state-machine trigger false-rejects no-op updates** — any `UPDATE` not changing `status` probes `(X,X)`, which isn't a legal transition, and raises. | Add `WHEN (OLD.status IS DISTINCT FROM NEW.status)` so identity/non-status updates bypass the check. | 🔴 critical |
| 4 | **Round-up trigger fires on the wrong leg with the wrong sign** — could sweep on the merchant credit leg, sweep twice, and compute `ceil()` on a *negative* debit amount → garbage. | Fire **only on the payer's `student_wallet` `spending` debit leg**; compute spare on `abs(amount)`; exactly one leg carries the discriminator. | 🔴 critical |
| 5 | **Escrow "dispute pauses the clock" contradicts a GENERATED `auto_release_at`** — a generated column can't pause/extend. | Drop the generated column; store a **mutable `release_deadline`** (funded+48h, extended by dispute duration on close), or compute release time in the cron function. One representation only. | 🟠 high |
| 6 | **Loyalty redemption mints money** — credited student BDT with no offsetting debit source. | Add a **`loyalty_pool` system account** (negative floor); redemption posts a balanced 2-leg BDT txn `student +BDT / loyalty_pool -BDT`. | 🟠 high |
| 7 | **Multi-sig threshold self-contradiction** — froze `required_threshold` but described counting `ceil(active/2)` *live* (defeats the snapshot defense). Enrollment date duplicated; `alumni_at` derived from the wrong source. | `execute_transfer()` uses the **frozen** `required_threshold` and counts approvals **only from the `approver_snapshot` set**. Derive `alumni_at` from **`student.enrollment_date`** (single source). | 🟠 high |

**Also applied:** demote the global hash-chain to **per-account** or an offline appendix (a global tip serializes every insert and fights the concurrency demo); keep monthly partitioning as an *optional* artifact where nothing FKs into `ledger_entry.entry_id`; collapse `balance_snapshot` into the `account_balance` cache; unify the RLS/audit identity GUC to **`app.current_user_id`** everywhere; add the required `UNIQUE` index before `REFRESH … CONCURRENTLY`.

**Representative SQL — corrected round-up sweep:**

```sql
CREATE FUNCTION sweep_roundup() RETURNS trigger AS $$
DECLARE v_step INT; v_spare NUMERIC(20,4); v_savings BIGINT;
BEGIN
  SELECT sc.step INTO v_step
  FROM student_wallet sw
  JOIN savings_config sc ON sc.student_id = sw.student_id AND sc.enabled
  WHERE sw.account_id = NEW.account_id AND sw.wallet_purpose = 'spending';
  IF v_step IS NULL THEN RETURN NULL; END IF;

  v_spare := ceil(abs(NEW.amount) / v_step) * v_step - abs(NEW.amount);   -- abs(): fix #4
  IF v_spare <= 0 THEN RETURN NULL; END IF;

  -- ... resolve the locked savings wallet, post a balanced 2-leg 'roundup_sweep' transfer ...
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_roundup AFTER INSERT ON ledger_entry
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0 AND NEW.txn_type = 'purchase' AND NEW.amount < 0)  -- payer debit only
  EXECUTE FUNCTION sweep_roundup();
```

---

## 6. Feature → DB-concept → rubric coverage matrix

| # | Feature | Primary DB concept showcased | Rubric line it earns |
|---|---|---|---|
| 3 | Unified Payment Hub | **EER generalization/specialization** (2-level, disjoint+total), deferred constraint triggers, RLS | ER/EER modeling, constraints, security |
| 1 | e-KYC Verification | Data-driven **state machine**, ENUM/partial-unique index, `GENERATED` column, temporal (`pg_cron`) | Constraints, triggers, temporal data |
| 2 | Multi-Currency Bridge | Multi-currency **double-entry** + FX clearing account, exact `NUMERIC`, `LATERAL`, effective-dated rates | Advanced SQL, temporal/versioned data |
| 4 | Event Wallets / Defaulters | **Set operations** `EXCEPT`/`INTERSECT`, `HAVING`, window fns, views | Advanced SQL (set ops, aggregation, views) |
| 5 | Multi-Signature Wallets | **M:N associative entities**, deferred constraint backstop, `FOR UPDATE` | Relationships, concurrency, deferred integrity |
| 6 | Round-Up Savings | **Recursion-safe `AFTER INSERT` trigger**, derived attribute, locked bucket | Triggers |
| 7 | Loyalty Points | **Stored procedure/function**, weighted aggregate, **derived attribute**, materialized view + `RANK()` | Procedures, aggregation, views |
| 8 | Peer Escrow | **ACID atomicity**, temporal locks, **`pg_cron` scheduled job**, state machine | Transactions, scheduling, concurrency |
| — | Cross-cutting | Immutable ledger, RLS + DCL roles, idempotency, `EXPLAIN ANALYZE` optimization, pgTAP tests, recursive CTE | Security, indexing/optimization, testing |

Every advanced SQL construct a DBMS rubric looks for — joins, subqueries, set operations, window functions, CTEs (incl. recursive), aggregates, views, materialized views — appears with a *genuine* purpose, not shoehorned.

---

## 7. Phased roadmap

> **Golden rule:** the walking skeleton (Phase 0–1) is demoable and gradeable on its own. Phases 4–5 are the **droppable tail**. **Never let a hard feature block the Phase 6 design artifacts** — the course grades database design.

### Phase 0 — Foundations, deploy pipeline & walking skeleton · *1–1.5 wk*
**Goal:** whole toolchain live end-to-end; a trivial-but-real payment moves money through an append-only ledger, deployed, from week one.
- Next.js + TS + PWA shell on Vercel; Supabase project with `pg_cron` + `pg_net`; pooled (6543) vs direct (5432) wiring; module-scoped `Pool`.
- `node-pg-migrate` set up; migration `0001` = `currency` (BDT/USD seeded), `account`, `ledger_transaction`, `ledger_entry`.
- pgTyped in CI; one typed query end-to-end. Supabase Auth email sign-in. A balanced 2-leg transfer via a stored function; balance shown as derived `SUM`. Three roles (`app_read`/`app_write`/`admin`) via `REVOKE`-then-`GRANT`. GitHub Actions CI + keep-alive.
- **Exit:** deployed URL where a logged-in user triggers a balanced, append-only, idempotent transfer; CI green.
- **Split:** Dev A = DB (schema, transfer fn, roles); Dev B = app/infra (PWA, `pg`+pgTyped, Vercel+Actions); Dev C = Auth + seed.

### Phase 1 — Payment Hub: generalization/specialization + ledger integrity core · *2 wk*  🔒 CORE
**Goal:** the crown-jewel DB artifacts most of the grade rides on.
- Disjoint+total two-level subtype hierarchy (declarative disjointness + deferred totality trigger).
- `DEFERRABLE INITIALLY DEFERRED` zero-sum-per-currency trigger. DB-enforced immutability (`REVOKE` + trigger; reversals). **RLS** (`ENABLE`+`FORCE`) keyed to `SET LOCAL app.current_user_id`. Generic `to_jsonb` **audit** trigger. Trigger-maintained balance cache + nightly `EXCEPT` reconciliation. Payment-hub UI + `v_payable_targets`. Concurrency-safe debit (`FOR UPDATE` + `SERIALIZABLE` retry-on-40001).
- **Exit:** an account can't exist in two subtypes or none (proven by failed inserts); an unbalanced txn is rejected at `COMMIT`; a user sees zero of another user's rows; every write is audited; a two-session race can't overdraw.

### Phase 2 — e-KYC state machine + round-up savings + loyalty · *2 wk*  🔒 CORE
- `kyc_state` + `state_transition` + reusable `enforce_transition()` trigger (with the `OLD.status IS DISTINCT FROM NEW.status` guard). `.edu.bd` email OR ID-card upload → private Storage bucket; `Pending→verified` admin action; partial-unique "one active KYC"; `alumni_at` GENERATED from `student.enrollment_date`.
- Recursion-safe round-up (corrected WHEN clause) into the locked savings bucket; withdrawal guard while `now() < locked_until`.
- Loyalty: append-only `point_ledger`, derived-`SUM` balance view, weighted `fn_award_points`, atomic `redeem_points()` (via the **`loyalty_pool`** account) under `FOR UPDATE` + idempotency; `mv_loyalty_leaderboard` (`RANK()`) with its required `UNIQUE` index, refreshed by `pg_cron`.
- **Exit:** illegal transitions raise; a purchase deposits the exact ceiling-difference without recursion; on-time dues award weighted points; redemption can't go negative or double-redeem on retry.

### Phase 3 — Event wallets & real-time defaulter list (set operations) · *1–1.5 wk*  🔒 CORE
- `event`/`event_roster`/`event_contribution`; a **live defaulter view** = `EXCEPT` (never paid) `UNION` a `HAVING SUM(paid) < expected` aggregate (partial payments handled; refunds re-add automatically). `INTERSECT` cross-club overlap. `GROUP BY`/`HAVING`/window %-of-target; `GROUPING SETS`/`ROLLUP`. Organizer dashboard.
- **Exit:** paying removes a student live; a partial payer still shows as a defaulter; a refund re-adds them; `INTERSECT` returns correct cross-club membership.

> **✅ End of Phase 3 = a complete, submittable, top-marks core.** Everything below is bonus.

### Phase 4 — Educational multi-currency FX bridge · *2 wk*  ⭐ BONUS
- Cross-currency purchase as **one transaction, 4 legs** (`student −X BDT` / `bridge +X BDT` / `bridge −Y USD` / `merchant +Y USD`); each currency independently nets to zero (the deferred trigger already enforces it via `GROUP BY currency`). Frozen `exchange_rate NUMERIC(24,12)`; effective-dated `fx_rate` history; `LATERAL` point-in-time lookup; documented rounding rule (bridge residual = realized FX); optional explicit `fx_fee` leg.
- **Exit:** a BDT-funded USD purchase balances per currency at `COMMIT`; the historical USD amount is reproducible months later; a mismatched-currency leg is rejected.

### Phase 5 — Multi-signature team wallets + peer escrow · *2–2.5 wk*  ⭐ BONUS (riskiest last)
- **Multi-sig:** `wallet_approver` (M:N), `pending_transfer` (frozen threshold + `approver_snapshot`), `transfer_approval` (PK prevents double-sign). `execute_transfer()`: `FOR UPDATE` + re-assert `status='pending'` + count approvals **from the snapshot set** vs the **frozen** threshold + flip + post balanced legs — atomic. `DEFERRABLE` backstop: no `executed` transfer may be under-signed.
- **Escrow:** state machine reusing `enforce_transition`; **mutable `release_deadline`** (dispute extends it); fund/release/refund procedures lock the row + assert pre-state. `pg_cron` `release_expired_escrows()` (idempotent, excludes disputed) every 5 min + external fallback. Optional `btree_gist EXCLUDE` scoped to the **listing** (not per buyer).
- **Live two-terminal concurrency demo** (double-spend / simultaneous co-sign) proving no anomaly.
- **Exit:** a transfer executes only on majority, exactly once under concurrent co-signing, never under-signed; an approver removed after signing can't flip the outcome; funded escrow auto-releases after 48h idempotently, a disputed one doesn't.

### Phase 6 — Hardening, optimization & grading deliverables · *1.5–2 wk*  🔒 NON-NEGOTIABLE
- **pgTAP** suite (`pg_prove` in CI): overdraft rejected, unbalanced txn rejected at commit, ledger `UPDATE` blocked, illegal transition blocked, RLS hides others' rows, round-up = exact ceiling diff, multi-sig executes only on majority.
- Realistic **seed** via `generate_series` (~5k students, ~200k txns, ~500k legs, FX history) so queries actually seq-scan.
- **`EXPLAIN (ANALYZE, BUFFERS)` before/after** for 3–4 real queries with purpose-built composite/partial/covering/BRIN indexes (+ optional monthly RANGE partition).
- **EER diagram** (disjoint `d` circle, total-participation double lines) + relational schema + **data dictionary** — names byte-identical across all artifacts.
- **Normalization writeup**: FDs, candidate keys, 1NF→BCNF proof for `ledger_entry`/`account`/`ledger_transaction`/`fx_rate`, with declared/justified denormalization (the cache).
- **Recursive CTE** with a genuine purpose (multi-hop FX path or club/referral hierarchy).
- Feature→rubric coverage matrix; `schema.sql`, `showcase-queries.sql`, `triggers_procedures.sql`, `seed.sql`; report + slide deck + **scripted live demo** (UI + visible SQL + triggers firing + EXPLAIN plans + the concurrency race).
- **Exit:** `pg_prove` green; each showcase query shows a measurable seq-scan→index-scan speedup; every entity traces EER→schema→DDL→report with identical names; the demo runs start-to-finish including the live race.

**Phase split summary (2–3 devs):** Dev A owns the DB spine (ledger, subtypes, triggers, normalization). Dev B owns integrity/security/perf (RLS, audit, seed, EXPLAIN, indexing) + FX/escrow logic. Dev C owns app/UI + diagrams + report + demo script. With 2 people, C's work distributes to A (DB-side artifacts) and B (app + report).

---

## 8. Grading deliverables checklist

- [ ] **EER diagram** — disjoint `d` + total-participation notation, centered on `Account → Student/Institutional → Hall/Exam/Cafeteria`.
- [ ] **Relational schema diagram** — all PKs/FKs labeled.
- [ ] **Normalization writeup** — FDs, candidate keys, 1NF→BCNF proof for the rich tables + justified denormalization.
- [ ] **Data dictionary** — every table/column with type, domain, constraint, description (names identical to EER + DDL).
- [ ] `schema.sql` — full DDL.
- [ ] `triggers_procedures.sql` — all triggers/constraint triggers/functions/procedures.
- [ ] `showcase-queries.sql` — one query per advanced construct, each commented with the rubric concept.
- [ ] **Migrations folder** (numbered up/down raw SQL).
- [ ] `seed.sql` — realistic Bangladesh campus dataset at seq-scan volume.
- [ ] **pgTAP suite** — green in GitHub Actions CI.
- [ ] **`EXPLAIN (ANALYZE, BUFFERS)` report** — before/after plans + one-line rationale each.
- [ ] **Concurrency/ACID demo** — two racing sessions, no double-spend / double-execution.
- [ ] **Feature→rubric coverage matrix.**
- [ ] **RLS + roles (DCL) doc** — least-privilege model + policies.
- [ ] **Free-tier deployment writeup** — Supabase + Vercel + `pg_cron` + Actions, pooling, host-independence.
- [ ] **Report + slide deck + scripted live demo.**

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Scope overrun** (8 features, 2–3 students, other courses) | Phases 0–3 = guaranteed core; 4–5 droppable; Phase 6 protected. |
| **Serverless connection exhaustion** | Transaction-mode pooler (6543) only; `Pool` max 1–3; 5432 for migrations only. |
| **Pooler breaks session state / RLS leak** | Keep each transaction self-contained (ideally one function call); always `SET LOCAL` inside an explicit txn; disable prepared-statement caching. |
| **Supabase 7-day auto-pause** | GitHub Actions keep-alive every ~3 days; commit periodically (Actions disables after ~60 days idle); **rehearse a cold resume before the demo.** |
| **Silent concurrency bugs** | `FOR UPDATE` + deterministic lock order; status-as-mutex + idempotency; `SERIALIZABLE` retry; explicit parallel-transaction test. |
| **Deferred triggers fail at COMMIT, not statement** | Use `DEFERRABLE INITIALLY DEFERRED` deliberately; translate commit-time SQLSTATE to friendly errors; test deferral explicitly. |
| **Round-up recursion / FX sub-paisa imbalance** | Depth guard + discriminator + separate target; one rounding rule at settlement boundary; per-currency zero-sum enforced. |
| **Design-artifact debt** | Keep entity names identical across EER/schema/DDL/report from Phase 1; Phase 6 non-negotiable. |
| **500 MB ceiling** | Scope audit to sensitive tables; seed→EXPLAIN→truncate the big dataset. |
| **Float precision regression** | `NUMERIC` everywhere + `CHECK(amount<>0)` + a pgTAP precision test. |

---

## 10. Curated stretch goals (pick 3–4 deep ones, not ten shallow ones)

The reviewer's warning: marginal flexes add risk/cost for little grade. **Recommended keepers:**
1. **Cause-then-prevent a concurrency anomaly** on screen (write-skew / double-spend under `READ COMMITTED`, then fixed) — the single highest-value differentiator.
2. **Live reconciliation invariant** — run `EXCEPT` (cache vs `SUM(ledger)`) on screen, show zero rows. Turns "derived vs stored" into proof.
3. **One reusable `enforce_transition()` engine** governing KYC + escrow + multi-sig — abstraction + a queryable legal-state graph.
4. **`btree_gist EXCLUDE`** temporal non-overlap constraint (scoped correctly) — a graduate-level constraint few student projects attempt.

**Demote/drop** (concurrency hazard or budget/complexity for little gain): global hash-chain (make per-account or offline appendix), monthly partitioning (optional artifact only), Sqitch *and* node-pg-migrate (pick one), Neon branching (a host you don't use), `balance_snapshot` (redundant with the cache).

---

## 11. Decisions I need from you

These are genuinely yours; I've picked sensible defaults but flag them so you can confirm or change (each is a one-line answer):

1. **Money representation** — `NUMERIC(20,4)` *(my default; clearest for a SQL-showcase course)* vs `BIGINT` integer minor-units (~50–70% faster). An examiner may ask; having the trade-off pre-written signals depth.
2. **Scope commitment** — build the *full* 8 (Phases 0–6) as planned, or hard-cap at the guaranteed core (0–3 + 6) and treat FX/multi-sig/escrow as reach?
3. **Overdraft policy** — every student/institutional account strictly `>= 0` (only system accounts go negative)? *(my default: yes.)*
4. **Loyalty clawback** — if dues are reversed after points were redeemed, allow a negative point balance (debt) or block the reversal? *(my default: block.)*
5. **Deploy host** — confirm **Supabase** (in-DB `pg_cron`), accepting the external-scheduler fallback as insurance?

---

*This plan was produced from a 10-agent research + design + adversarial-review pass. Every entity, trigger, and phase above reflects the corrected design after the review caught 7 correctness bugs in the first draft.*
