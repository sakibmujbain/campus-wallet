# Campus Wallet

A student fintech platform built as a PostgreSQL-first **DBMS course project**.
Design philosophy: **thin app, smart database** — every money-moving invariant lives
in Postgres; Next.js only orchestrates and presents.

> **Full design & phased roadmap:** see [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).
> This README covers running **Phase 0 — the ledger spine**, which is scaffolded here.

---

## What's in Phase 0

A working, deployable slice that proves the accounting core:

- **Immutable append-only double-entry ledger** (`ledger_transaction` + `ledger_entry`).
- **Exact money** — `NUMERIC(20,4)`, never float. Balances are **derived**, cached by a trigger.
- **Per-currency zero-sum** enforced at `COMMIT` by a `DEFERRABLE INITIALLY DEFERRED` constraint trigger.
- **Per-account overdraft floor**, idempotent transfers, `SELECT … FOR UPDATE` under `SERIALIZABLE` with retry.
- **Least-privilege roles** (`app_read` / `app_write` / `app_admin`); ledger `UPDATE`/`DELETE` revoked.
- A **Next.js PWA** showing live balances and posting transfers via the `make_transfer()` DB function.
- **CI** that migrates a throwaway Postgres and runs a ledger **smoke test** of every invariant.

## Tech stack

| | |
|---|---|
| Database | PostgreSQL (Supabase free tier) |
| App | Next.js (App Router) + TypeScript, installable PWA |
| DB access | `node-postgres` (raw SQL), pgTyped for compile-time types — **no ORM** |
| Migrations | `node-pg-migrate` (raw-SQL, up/down) |
| Deploy | Vercel Hobby (app) + Supabase (DB) + GitHub Actions (CI, keep-alive) |

---

## Prerequisites

- **Node ≥ 20** (`nvm use` reads `.nvmrc`).
- A free **Supabase** project — or any local PostgreSQL 15/16 for offline dev.

## 1. Install

```bash
npm install
```

## 2. Configure the database

Copy the env template and fill in your Supabase connection strings:

```bash
cp .env.example .env
```

In Supabase → **Settings → Database** you'll find two connection strings. Map them:

- `DATABASE_URL` → the **Transaction pooler** URL (port **6543**). The app uses this.
- `DATABASE_URL_DIRECT` → the **Direct** URL (port **5432**). Migrations/seeds use this.

> Using a **local** Postgres instead? Set both to
> `postgresql://postgres:postgres@localhost:5432/campus_wallet` and skip SSL (auto-detected).

## 3. Migrate & seed

```bash
npm run migrate     # creates the ledger spine (tables, triggers, functions, roles)
npm run db:seed     # opening treasury + two funded demo wallets (safe to re-run)
```

## 4. Prove the invariants (optional but recommended)

```bash
npm run db:smoke
```

Expected output — every check passes:

```
✓ balanced transfer derives correct balances
✓ idempotent replay does not double-charge
✓ overdraft debit rejected (23514)
✓ ledger UPDATE rejected (23001)
✓ ledger DELETE rejected (23001)
✓ unbalanced transaction rejected (23000)
ALL CHECKS PASSED — 6 passed
```

## 5. Run the app

```bash
npm run dev        # http://localhost:3000
```

You'll see live wallet balances and a transfer form. Posting a transfer calls
`make_transfer()` inside one atomic, idempotent, serializable transaction.

## 6. (Optional) Generate typed SQL

```bash
npm run pgtyped    # reads src/db/queries/*.sql, emits *.queries.ts (needs a live DB)
```

---

## Deploying on free tiers

1. **Supabase**: create a project. In **Database → Extensions**, enable `pg_cron` and `pg_net`
   (needed by later phases). Run `npm run migrate` and `npm run db:seed` against the **direct** URL.
2. **Vercel**: import the repo. Add env vars `DATABASE_URL` (the **pooler/6543** URL) and `PG_POOL_MAX=3`.
   Deploy — Next.js is first-party on Vercel.
3. **Keep-alive**: add a repo secret `KEEPALIVE_URL = https://<your-app>.vercel.app/api/health`.
   The `Keep-alive` workflow pings it every 3 days so the free DB never auto-pauses.

See `IMPLEMENTATION_PLAN.md` §4 for the full architecture, gotchas, and why Supabase is the host.

---

## Project layout

```
migrations/0001_ledger_spine.sql   The ledger spine: DDL + triggers + functions + roles
db/seed.sql                        Demo data via real double-entry postings
scripts/migrate.mjs                Cross-platform migration runner (direct connection)
scripts/run-sql.mjs                Runs an arbitrary .sql file (seeds, ad-hoc)
scripts/smoke.mjs                  Integration test asserting every ledger invariant
src/db/pool.ts                     Pooled pg connection (Supabase transaction pooler)
src/db/tx.ts                       Transaction helper: SET LOCAL identity + SERIALIZABLE retry
src/db/accounts.ts                 Query layer (raw parameterized SQL)
src/db/queries/balances.sql        pgTyped example (SQL as source of truth)
src/app/                           Next.js App Router UI + /api/transfer + /api/health
.github/workflows/                 CI (migrate + smoke + build) and keep-alive
```

## Command reference

| Command | Does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm run build` | Production build / type-check |
| `npm run migrate` | Apply all pending migrations (direct connection) |
| `npm run migrate:down` | Roll back the latest migration |
| `npm run migrate:create -- <name>` | Scaffold a new raw-SQL migration |
| `npm run db:seed` | Seed demo accounts |
| `npm run db:smoke` | Run the ledger invariant test suite |
| `npm run pgtyped` | Regenerate typed SQL from `src/db/queries/*.sql` |

---

## Roadmap (from `IMPLEMENTATION_PLAN.md`)

| Phase | Focus | Status |
|---|---|---|
| **0** | Foundations & ledger spine | ✅ done |
| **1** | Payment Hub — generalization/specialization, RLS, audit | ✅ done |
| 2 | e-KYC · round-up savings · loyalty | next |
| 3 | Event wallets & defaulter list (set ops) | |
| 4 | Multi-currency FX bridge | bonus |
| 5 | Multi-sig wallets & peer escrow | bonus |
| 6 | Hardening: pgTAP, EXPLAIN, EER, normalization, demo | required |

**Phase 1 adds** (migration `0002`): a two-level disjoint+total account subtype hierarchy
(`student_wallet` / `institutional_wallet` → `hall_administration`/`exam_controller`/`cafeteria_till` / `system_account`),
`open_*` helper functions, Row-Level Security, a generic append-only audit trail, symmetric
cache↔ledger reconciliation, the `/hub` payment page, and the `app_user`/`student`/`hall` entities.
The smoke suite grows to **12 checks** (adds totality, disjointness, RLS isolation, audit, reconciliation,
and a non-bypass-role commit regression).
