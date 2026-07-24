import { pool } from "@/db/pool";
import { withTransaction } from "@/db/tx";

// ── Reconciliation ──────────────────────────────────────────────────────────

export interface DriftRow {
  accountId: number;
  currency: string;
  cached: string | null;
  ledger: string | null;
  /** (ledger - cached) computed in NUMERIC — exact, never a JS float. */
  diff: string;
}

/** Rows where the O(1) balance cache disagrees with SUM(ledger). Healthy = []. */
export async function listDrift(): Promise<DriftRow[]> {
  const { rows } = await pool.query(
    `SELECT account_id::int AS "accountId", currency, cached::text, ledger::text,
            (COALESCE(ledger, 0) - COALESCE(cached, 0))::text AS diff
       FROM reconcile_balances() ORDER BY account_id`,
  );
  return rows as DriftRow[];
}

export interface SystemSnapshot {
  accounts: number;
  drift: number;
  auditRows: number;
  treasury: string;
  loyaltyPool: string;
  external: string;
}

export async function systemSnapshot(): Promise<SystemSnapshot> {
  const sysBal = (role: string) =>
    `(SELECT COALESCE(b.balance,0)::text FROM account_balance b JOIN system_account s ON s.account_id=b.account_id WHERE s.system_role='${role}' LIMIT 1)`;
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM account)                 AS accounts,
            (SELECT count(*)::int FROM reconcile_balances())    AS drift,
            (SELECT count(*)::int FROM audit_log)               AS "auditRows",
            COALESCE(${sysBal("treasury")}, '0')     AS treasury,
            COALESCE(${sysBal("loyalty_pool")}, '0') AS "loyaltyPool",
            COALESCE(${sysBal("external")}, '0')     AS external`,
  );
  return rows[0] as SystemSnapshot;
}

// ── Audit trail ─────────────────────────────────────────────────────────────

export interface AuditRow {
  id: number;
  table: string;
  op: string;
  actorRole: string;
  changedBy: number | null;
  changedByName: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}

export async function listAudit(table: string | null, limit = 100): Promise<AuditRow[]> {
  const { rows } = await pool.query(
    `SELECT al.id::int, al.table_name AS "table", al.op, al.actor_role AS "actorRole",
            al.changed_by::int AS "changedBy", au.full_name AS "changedByName",
            al.row_before AS "before", al.row_after AS "after", al.changed_at::text AS "at"
       FROM audit_log al
       LEFT JOIN app_user au ON au.user_id = al.changed_by
      WHERE ($1::text IS NULL OR al.table_name = $1)
      ORDER BY al.id DESC
      LIMIT $2`,
    [table, limit],
  );
  return rows as AuditRow[];
}

/** Distinct audited tables (for the filter dropdown). */
export async function listAuditTables(): Promise<string[]> {
  const { rows } = await pool.query(`SELECT DISTINCT table_name FROM audit_log ORDER BY table_name`);
  return rows.map((r) => r.table_name as string);
}

/** id → full name, to turn the bare user ids in audit diffs into readable names. */
export async function getUserNames(): Promise<Record<number, string>> {
  const { rows } = await pool.query(`SELECT user_id::int AS id, full_name FROM app_user`);
  const map: Record<number, string> = {};
  for (const r of rows) map[r.id] = r.full_name as string;
  return map;
}

// ── Payees (institutional wallets) ──────────────────────────────────────────

export interface Payee {
  accountId: number;
  currency: string;
  instKind: string;
  label: string;
  balance: string;
}

export async function listPayees(): Promise<Payee[]> {
  const { rows } = await pool.query(
    `SELECT t.account_id::int AS "accountId", t.currency, t.inst_kind AS "instKind", t.label,
            COALESCE(b.balance, 0)::text AS balance
       FROM v_payable_targets t
       LEFT JOIN account_balance b ON b.account_id = t.account_id
      ORDER BY t.inst_kind, t.label`,
  );
  return rows as Payee[];
}

export interface Hall { hallId: number; name: string }

export async function listHalls(): Promise<Hall[]> {
  const { rows } = await pool.query(`SELECT hall_id::int AS "hallId", name FROM hall ORDER BY name`);
  return rows as Hall[];
}

export async function openPayee(adminId: number, kind: string, ref: string, ref2: string | null): Promise<number> {
  return withTransaction(async (c) => {
    const { rows } = await c.query(`SELECT admin_open_payee($1,$2,$3,$4) AS id`, [adminId, kind, ref, ref2]);
    return Number(rows[0].id);
  }, { userId: adminId });
}

// ── e-KYC ───────────────────────────────────────────────────────────────────

export interface KycRow {
  verificationId: number;
  studentId: number;
  studentName: string;
  studentNo: string | null;
  method: string;
  storedStatus: string;
  effectiveStatus: string;
  verifiedAt: string | null;
  expiresAt: string | null;
}

export async function listKyc(limit = 100): Promise<KycRow[]> {
  const { rows } = await pool.query(
    `SELECT k.verification_id::int AS "verificationId", k.student_id::int AS "studentId",
            au.full_name AS "studentName", st.student_no AS "studentNo", k.method,
            k.stored_status AS "storedStatus", k.effective_status AS "effectiveStatus",
            k.verified_at::text AS "verifiedAt", k.expires_at::text AS "expiresAt"
       FROM v_kyc_effective k
       JOIN app_user au ON au.user_id = k.student_id
       JOIN student  st ON st.student_id = k.student_id
      ORDER BY (k.stored_status = 'pending') DESC, k.verification_id DESC
      LIMIT $1`,
    [limit],
  );
  return rows as KycRow[];
}

export async function approveKyc(adminId: number, verificationId: number): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`SELECT admin_approve_kyc($1,$2)`, [adminId, verificationId]);
  }, { userId: adminId });
}
