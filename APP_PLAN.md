# Campus Wallet — Product & Frontend Plan
### From a thin demo UI to a real, role-aware student fintech app

> Synthesized from a 6-agent design pass (app-shell/IA · student UX · admin console · CR/organizer console · backend gaps · adversarial critic). The critic caught that the raw designs modeled the fee subsystem four different ways and **omitted the product's precondition — a way for students to put money in**. This plan resolves every conflict into one canonical design.

---

## 0. The one-paragraph vision

Campus Wallet is a mobile-first PWA where a verified `.edu.bd` student sees **one home screen** with their balance, their **assessed dues**, savings, and rewards, and can **pay the exact fees** an institution has set — with the spare change auto-saved and campus spending earning points. **CRs** spin up batch/club collection drives and chase defaulters live. **Admins** control the levers — the **fee catalog**, roles, KYC approvals, and system config — every change on an immutable, audited ledger. The money engine is already built and correct; this plan is the **product, roles, and authorization layer** on top of it.

---

## 1. The four roles & how you become them

Everyone is a **student first** (everyone has a wallet). Elevated powers are **scoped grants**, not a replacement identity — this resolves the "a student who is *also* a CR" incoherence the critic flagged.

| Role | What they get | How you become it |
|---|---|---|
| **Student** | Wallet, dues, savings, loyalty, event participation | Sign up with `.edu.bd` (auto-provisioned) |
| **CR** | Create batch collection drives, manage roster, chase defaulters | **Request** → admin approves (scoped to a batch) |
| **Club exec** | Same, scoped to a club; manage club membership | Request → admin approves (scoped to a club) |
| **Institution** | Own a hall/exam/cafeteria wallet; define its fees; assess dues | Admin grants (scoped to an institutional wallet) |
| **Admin** | The control plane: fee catalog oversight, roles, KYC, config, monitoring | Seeded super-admin; admin promotes others |

**Model:** keep `app_user.role` only as a coarse `student | admin` flag, and add a **`role_grant(user_id, capability ∈ {cr,club_exec,institution,admin}, scope_kind, scope_ref, granted_by, granted_at)`** table as the real authority. A CR is a *student* with a `cr` grant scoped to `batch=CSE-2021`. Scope is enforced **in code** (see §5), never UI-only.

---

## 2. Information architecture — the full route map

Route groups by access tier; one shared shell and design system across all of them.

```
(public)
  /login                     sign in / create account (.edu.bd)

(student)  — everyone with a wallet
  /                          Dashboard: balance, DUES nudge, quick actions, recent activity
  /onboarding                first-run wizard (once), Add-to-Home
  /dues                      assessed fees → pay EXACT amount (core loop)
  /hub                       discretionary campus spend (cafeteria) → round-up + points
  /wallet                    ledger statement (my accounts, per-txn receipt)
  /receipt/[txnId]           immutable receipt (my leg only)
  /savings                   Tuition Shield: round-up history, lock, tune step
  /rewards                   points, redeem→BDT, leaderboard
  /my-events                 batch/club drives I'm on: what I owe, pay, history
  /kyc                       verification status (+ ID-card upload = next increment)
  /profile                   identity, role, "Request a role", theme, sign out
  /notifications             in-app inbox
  /top-up                    add balance (see §6 — the precondition)

(cr / club_exec)  — students with an organizer grant
  /cr                        my drives: portfolio + collection summary
  /cr/new                    create a drive (scope-constrained)
  /cr/drives/[id]            live collection dashboard
  /cr/drives/[id]/roster     manage who owes what
  /cr/drives/[id]/defaulters defaulter list + one-tap reminders
  /cr/drives/[id]/refunds    capped refunds
  /cr/drives/[id]/settle     close & settle to an institutional/club treasury
  /cr/clubs[/id]             club membership (club_exec)

(institution)  — fee owners
  /institution               inbound collections for my wallet(s)
  /institution/fees          define/edit fees for MY scope
  /institution/assessments   assess dues to cohorts

(admin)  — the control plane
  /admin                     KPIs, health, pending work, reconcile status
  /admin/fees[...]           full fee catalog (all scopes) + assess (bulk)
  /admin/assessments         cross-fee dues monitor
  /admin/users               directory: promote/demote, review role requests
  /admin/kyc                 e-KYC approvals (esp. ID-card scans)
  /admin/wallets             create payees (exam/hall/cafeteria/…), balances
  /admin/config              loyalty rates, savings defaults, currencies, top-up source
  /admin/audit               append-only audit_log viewer (before/after diffs)
  /admin/reconcile           cache-vs-ledger reconciliation, treasury/pool
```

**App shell (product-grade):** mobile = header (balance chip · 🔔 · avatar/role menu) + **bottom tab bar** (Home · Dues · Pay · Rewards · More); desktop = left **sidebar** with role-aware sections. A **"Wallet ⇄ Console" switcher** in the profile menu for users who hold an organizer/admin grant.

---

## 3. The student daily-use loop (the heart of the app)

```
Open app ──► Dashboard
              │  "You owe ৳2,300 in dues"  ← the nudge
              ▼
           /dues ──► tap "CSE Semester Exam · ৳1,500"  (amount is FIXED, not editable)
              │        └─ if balance < 1,500 → inline "Top up ৳X" CTA  ← precondition handled
              ▼
           Confirm sheet (exact charge, payee, balance after)
              ▼
           pay_fee() ──► ledger posts ──► assessment marked PAID ──► Receipt
              ▼
           Dashboard updates: dues ↓, balance ↓, activity ↑
```

Alongside the mandatory-dues loop: **discretionary spend** at `/hub` (cafeteria) *does* round up + earn points; **redeem** points→BDT at `/rewards`; **watch** the Tuition Shield grow passively. Every screen ships **skeleton / empty / error** states (e.g. `/dues` empty = "You're all paid up 🎉").

---

## 4. The canonical data model (resolving the 4-way fork)

One dues schema, chosen and written down. **Snapshot the amount at assess-time; exact single settlement (no partials, no client amount).**

```sql
-- migration 0006 — fee catalog + assessments (dues)
CREATE TABLE fee_item (
  fee_item_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                 TEXT NOT NULL,                 -- "CSE Semester Exam"
  category             TEXT NOT NULL,                 -- exam | hall_rent | cafeteria | library | misc
  collector_account_id BIGINT NOT NULL REFERENCES institutional_wallet(account_id), -- where money lands
  amount               NUMERIC(20,4) NOT NULL CHECK (amount > 0),   -- the CURRENT price
  scope_kind           TEXT NOT NULL,                 -- all | batch | department | hall
  scope_ref            TEXT,                          -- 'CSE-2021' / 'Shaheed Smriti Hall' / NULL
  active               BOOLEAN NOT NULL DEFAULT true,
  created_by           BIGINT, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE student_assessment (
  assessment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES student(student_id),
  fee_item_id   BIGINT NOT NULL REFERENCES fee_item(fee_item_id),
  period        TEXT NOT NULL,                        -- 'Spring-2026'
  amount_due    NUMERIC(20,4) NOT NULL,               -- SNAPSHOT of fee_item.amount at assess time
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','void')),
  assessed_by   BIGINT, assessed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, fee_item_id, period)            -- can't double-assess
);

CREATE TABLE assessment_payment (              -- links the ledger txn that paid it
  assessment_id BIGINT PRIMARY KEY REFERENCES student_assessment(assessment_id),
  txn_id        BIGINT NOT NULL REFERENCES ledger_transaction(txn_id)
);
```

- **`assess_fees(fee_item, period, scope_override?)`** — resolves the cohort, `INSERT … ON CONFLICT DO NOTHING` (idempotent), **snapshots** `amount_due`, emits notifications.
- **`pay_fee(assessment_id, idem)`** `SECURITY DEFINER` — the atomic core: `SELECT … FOR UPDATE`, verify **owner = session user** and `status='open'`, `make_transfer(student_spending → collector_account, amount_due)` (**not `make_purchase`** → mandatory fees don't mint points, §5), record `assessment_payment`, flip to `paid`, all in one txn; idempotent + foreign-idem guard (like `pay_event`). *Payer is server-derived, never from the client.*
- **`v_student_dues`** — the student's `open` assessments with label + collector, for `/dues` and the dashboard nudge.
- **Snapshot rationale:** editing a fee's amount only affects *future* assessments; a student never sees what they owe change after the fact. Price history is recoverable from `audit_log` — so we **reject the temporal `fee_schedule` + `btree_gist EXCLUDE`** table as over-engineering.

**Other new tables** (small): `role_grant` (§1), `role_request(user_id, requested_role, scope, justification, status, decided_by)`, `notification(user_id, kind, title, body, link, read_at, created_at)`, `event.status/deadline/description` columns (draft→open→closed→settled→cancelled via the existing `state_transition` engine), and an admin `app_config`/`academic_period` singleton. **`student.department`** column is needed (exam fees scope by department; today `student` only has `hall_id`/`batch`).

**Everything maps to the existing ledger** — paying a fee is just `make_transfer` legs whose `txn_id` is recorded against the assessment. The ledger stays the single source of truth; `audit()` triggers extend to `fee_item`, `student_assessment`, `role_grant`, `loyalty_rule`.

---

## 5. Authorization & security architecture ⚠️ (the make-or-break layer)

The critic's central finding: **the app connects as Supabase `postgres`, which BYPASSES RLS**, and middleware treats **all `/api` as public**. So RLS protects nothing at runtime and every new mutating route is exploitable if it forgets a check. This layer is a **release blocker**, built *before* any console UI.

**Three enforced layers (defense-in-depth):**
1. **Middleware** (edge, auth-only): refresh session, redirect unauthenticated page requests to `/login`, and **redirect `/admin` `/cr` `/institution` page routes** by coarse role. No DB there.
2. **`requireViewer(minRole|capability)`** — a single mandatory server helper used by **every protected RSC layout AND every mutating API route**. It calls the new **`getViewer()`** which resolves `{appUserId, role, grants}` from Postgres for **any** app_user (today `getStudent()` returns null for non-students, so *staff can't load a single page* — this is the #1 unblock). Any route without `requireViewer` is a blocked release.
3. **RLS as backstop** — kept, and made *real* for reads by routing queries through a per-request **`SET LOCAL ROLE app_authenticated`** + `SET LOCAL app.current_user_id` (a non-bypass role). *Adopt fully or not at all* — the interim honest posture is "every read helper filters by `appUserId`, and we audit every new view for a missing filter."

**Scope enforced in code, not UI** (the exploit class the critic flagged):
- Institution users may only edit fees whose `collector_account_id` is a wallet **their `role_grant` covers**; `SECURITY DEFINER` functions verify the caller's grant.
- **Role management hardening:** students **cannot request `admin`**; `promote_user`/`decide_role_request` require an admin caller; **can't demote the last admin**; all privileged writes go through `withTransaction({userId})` so `audit_log.changed_by` is populated (else the "all changes audited" promise fails for exactly the sensitive actions).
- **CR settlement can't self-pay:** `settle_event` destination is restricted to an **institutional/club treasury**, never the organizer's personal wallet (embezzlement vector).
- **No pay-as-another:** every pay/refund function derives the payer from the session (the `/api/pay` template), never a client-supplied account.
- **Loyalty-on-fees resolved:** mandatory dues use `make_transfer` (no points, no round-up); only **discretionary** spend (`/hub` cafeteria) uses `make_purchase`. This also stops "paying tuition mints redeemable BDT."
- **KYC PII:** the `/admin/kyc` signed-URL endpoint for ID scans must assert admin — the role gate is the *only* protection since reads bypass RLS.

**The `/api/pay` route is the copyable template** for every new route: session-derived actor, server-side target authorization, Zod NUMERIC-as-string, `SQLSTATE → 422` business errors vs `500`. Extract a shared **`requireViewer()` + `mapPgError()` + `money()`** so it's consistent everywhere.

---

## 6. The precondition the designs missed: **top-up / cash-in**

Without it, "pay the exact ৳1,500 fee" is impossible past the ৳1,000 welcome credit. Plan:
- A **`top_up(student, amount)`** function = `make_transfer(external_system_account → student_spending)` (the `system_account` role `'external'` already models the outside rail — bKash/bank/card in production).
- **Student `/top-up`**: choose an amount → for the demo, a clearly-labelled **"Add balance (demo cash-in)"** credits from the external/treasury rail instantly. In production this is where a **bKash / card gateway** slots in — one function swap, the ledger side is unchanged.
- **Admin/cashier top-up**: `/admin/wallets` (or an institution "cash desk") can credit a student, modelling a physical deposit. Audited.
- Inline **"Top up ৳X"** CTA on `/dues` when balance < the fee.

---

## 7. Cross-cutting product details

- **Notifications:** in-app `notification` table + `/notifications` inbox + a header bell with unread count. **Polling** (revalidate on focus) for the free tier — *defer* web-push and Supabase Realtime.
- **Receipts:** `/receipt/[txnId]` shows the student's own leg only (authorized per-query by `appUserId`), the payee, amount, and time — immutable, shareable.
- **Design system:** formalize the tokens already in `globals.css` (teal accent, dark-mode, mono tabular money) into a documented layer + a component inventory: `Button, Card, Table, Modal/Sheet, Toast, Badge, EmptyState, Skeleton, Tabs, StatTile, ProgressBar, Avatar, DropdownMenu`. Every screen specifies loading/empty/error.
- **PWA:** replace the single `icon.svg` with real **192/512 + maskable PNGs**, add an `/offline` shell; installable, standalone.
- **Money-path failure states:** insufficient balance → top-up CTA (not a dead end); KYC expired → can view but not pay (dues still accrue); every business error is a friendly inline message, not a stack trace.

---

## 8. What the critic said to defer (keep scope shippable)

Temporal fee-price versioning (`EXCLUDE` gist) · multi-sig settlement · CSV roster import · Bangla i18n & numerals · web-push · Supabase Realtime · offline write-queue · ID-card KYC upload (that's the *next* increment, already scoped) · FX bridge / escrow (bonus phases). Ship **in-app notifications via polling** and a **single `fee_item.amount` + snapshot**.

---

## 9. Phased build roadmap

**Phase A — Identity & authorization foundation (blocks everything; ~first).**
`getViewer()` (any app_user) · `requireViewer(minRole/capability)` · seed a **super-admin** · `role_grant` + `role_request` tables · middleware page-role gating · extract `requireViewer/mapPgError/money`. *Exit: an admin and a CR can load their (empty) consoles; a student can't reach `/admin`.*

**Phase B — Fee catalog → dues → pay (the core product loop) + top-up.**
migration 0006 (fee_item/assessment/payment, `student.department`) · `assess_fees`/`pay_fee`/`v_student_dues` · **top-up** function + `/top-up` · student `/dues` + confirm + `/receipt` + dashboard nudge · admin `/admin/fees` (+ audited edits) + `/admin/fees/[id]/assess` (dry-run→confirm). *Exit: admin sets a ৳1,500 exam fee → assesses CSE-2021 → a student tops up and pays the exact amount → receipt + audited.*

**Phase C — Roles in the app.**
`/profile` "Request a role" · `/admin/users` promote/demote + role-request queue (hard server checks, last-admin guard) · role-aware nav + Wallet⇄Console switcher.

**Phase D — CR/organizer console.**
event lifecycle columns · `/cr` portfolio · `/cr/new` (scope-constrained) · drive dashboard (reuse `v_event_progress`/`v_event_defaulters`) · roster mgmt · defaulters + reminders (notifications) · capped refunds · **settle** (destination-restricted).

**Phase E — Institution surface + admin depth.**
`/institution/*` (scoped fees/assessments) · `/admin/kyc` approvals · `/admin/config` (loyalty/savings/currency) · `/admin/wallets` (payee provisioning — grant `open_*` to admin) · `/admin/audit` + `/admin/reconcile` monitoring.

**Phase F — Product polish & PWA.**
design-system pass, skeleton/empty/error everywhere, real PWA icons + offline shell, notification inbox polish, statement/receipt exports, accessibility.

Each phase ends with the same discipline we've used all along: **live smoke checks + an adversarial review** of the new SQL/routes before moving on.

---

## 10. Decisions (RESOLVED with the stakeholder)

1. **Top-up:** ✅ **self-service demo cash-in** (add balance instantly from the external rail); MFS/bank transfer added later.
2. **Fees & points:** ✅ **no points on mandatory dues** (`pay_fee` uses `make_transfer`); discretionary cafeteria spend still rounds up + earns.
3. **RLS:** ✅ **MVP-filter now, harden later** — disciplined `WHERE me` on every query + reviews; a dedicated `SET LOCAL ROLE` pass after features land.
4. **Fee-setting:** ✅ **admin-only first**; scoped-institution editing in Phase E.
5. **`student.department`:** ✅ **optional field at signup + admin override.**

## 11. Build status

- **Phase A — Identity & authorization foundation: ✅ DONE & verified live.** Migration `0006` (`role_grant`, `role_request`, `is_admin`/`ensure_admin`/`request_role`/`promote_user`/`demote_user`/`decide_role_request`, audited); `getViewer()`/`requireViewer()`; `getStudent()` refactored onto it; gated `/admin` + `/cr` console shells; dashboard console links; `money()`/`mapPgError()` helpers; admin bootstrap via the **`ADMIN_EMAILS` allowlist only** (no first-user magic) + in-app promotion. Smoke = **35 checks** green.
- **Phase B — Fee catalog → dues → pay + top-up: ✅ DONE & verified live.** Migration `0007` (`fee_item`, `student_assessment` with SNAPSHOT amount, `assessment_payment`, `student.department`; `create_fee_item`/`set_fee_amount`/`assess_fees`/`pay_fee`/`top_up`; `v_student_dues`; audited). `pay_fee` = session-derived payer, exact snapshot, **no points** (make_transfer); admin-only fee mgmt; self-service `top_up` (external rail). Student `/dues` (list + exact pay) + `/top-up`; dashboard dues nudge; admin `/admin/fees` (create + assess). Adversarial review fixed **7** (incl. a **critical** idem-replay that could clear a same-collector due for free — now bound to the exact assessment via `UNIQUE(assessment_payment.txn_id)` + replay short-circuit). Smoke = **43 checks** green.
- **Phase C — Roles in the app: ✅ DONE & verified live.** Migration `0008` (`set_student_department` — admin-guarded, audited — enabling department-scoped fees). Student `/profile` (identity, e-KYC badge, current grants, **"Request a role"** → `request_role`, never admin). Admin `/admin/users` (role-request approval queue → `decide_role_request`; user directory with scoped **promote/demote** → `promote_user`/`demote_user`, and inline **department assignment**). `db/admin.ts` query+mutation layer (grants carry scope as jsonb; all writes via `withTransaction({userId})`). Dashboard **Profile** link. Fixed a `<form>`-in-`<p>` hydration error on `/profile`. Smoke = **46 checks** green.
- **Phase D — CR/organizer console: ✅ DONE & verified live.** Migration `0009` (event lifecycle `status`/`deadline`/`description`/`settled_txn_id`; `create_drive` — **scope-enforced** via `organizer_covers()` + roster auto-populate from the batch/club cohort; `add/remove_from_roster`, `set_drive_status`; `pay_event` **replaced** to reject payment to a non-`open` drive; `settle_event` — sweeps the pool to an **institutional wallet only**, idempotent by settled-status; `notification` spine + `remind_defaulters` + `mark_notifications_read`; all audited). `db/organizer.ts` + `db/notifications.ts`; API `/api/cr/drives`, `/api/cr/drives/[id]` (roster/status/refund/settle/remind), `/api/notifications/read`. Pages: `/cr` portfolio, `/cr/new` (scope-constrained), `/cr/drives/[id]` dashboard (roster+refund, defaulters+remind, lifecycle, settle), `/notifications` inbox + dashboard **bell**. Adversarial review (6-agent + verify): 13 raw → **6 confirmed** → all fixed — refund now threads a client **idempotency key** (no double-refund on retry); `remind_defaulters` deduped on unread-per-drive; `mapPgError` maps `40001/40P01`→409 and `22003/22007/22008`→422; read-committed mutations retry deadlocks; bounded numeric + real-date Zod validation. Migration `0010` closes refunds on a **settled** drive (its pool was swept to the treasury) with a clear 422 instead of a cryptic overdraft error, and the drive console hides refund/roster controls once settled. Smoke = **58 checks** green. Next: **Phase E** — institution surface + admin depth.

---

*Produced from a 6-agent design + adversarial-critique workflow. The money engine (ledger, hierarchy, KYC, savings, loyalty, events) is built and verified; this plan is the product, role, and authorization layer that turns it into a real app — with the canonical dues schema, the missing top-up path, and the security foundation resolved up front.*
