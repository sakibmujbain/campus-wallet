import { pool } from "@/db/pool";
import { withTransaction } from "@/db/tx";

export interface SavingsDetail {
  accountId: number | null;
  balance: string;
  lockedUntil: string | null;
  enabled: boolean;
  step: number;
  /** Lifetime round-up count/total (aggregate over ALL sweeps, not the 20-row history page). */
  roundupCount: number;
  roundupTotal: string;
}
export interface RoundupEntry { amount: string; createdAt: string; description: string | null }

export async function getSavingsDetail(appUserId: number): Promise<SavingsDetail> {
  const { rows } = await pool.query(
    `SELECT sw.account_id::int AS "accountId", COALESCE(b.balance, 0)::text AS balance,
            sw.locked_until::text AS "lockedUntil",
            COALESCE(sc.enabled, false) AS enabled, COALESCE(sc.step, 10)::int AS step,
            (SELECT count(*)::int FROM ledger_entry le JOIN ledger_transaction lt ON lt.txn_id = le.txn_id
              WHERE le.account_id = sw.account_id AND lt.kind = 'roundup_sweep' AND le.amount > 0) AS "roundupCount",
            (SELECT COALESCE(SUM(le.amount), 0)::text FROM ledger_entry le JOIN ledger_transaction lt ON lt.txn_id = le.txn_id
              WHERE le.account_id = sw.account_id AND lt.kind = 'roundup_sweep' AND le.amount > 0) AS "roundupTotal"
       FROM student_wallet sw
       LEFT JOIN account_balance b ON b.account_id = sw.account_id
       LEFT JOIN savings_config sc ON sc.student_id = sw.student_id
      WHERE sw.student_id = $1 AND sw.wallet_purpose = 'savings'`,
    [appUserId],
  );
  return (rows[0] ?? { accountId: null, balance: "0", lockedUntil: null, enabled: false, step: 10, roundupCount: 0, roundupTotal: "0" }) as SavingsDetail;
}

/** Round-up sweeps into this student's savings wallet (the credit legs). */
export async function listRoundupHistory(appUserId: number, limit = 20): Promise<RoundupEntry[]> {
  const { rows } = await pool.query(
    `SELECT le.amount::text AS amount, lt.created_at::text AS "createdAt", lt.description
       FROM ledger_entry le
       JOIN ledger_transaction lt ON lt.txn_id = le.txn_id
       JOIN student_wallet sw ON sw.account_id = le.account_id
      WHERE sw.student_id = $1 AND sw.wallet_purpose = 'savings'
        AND lt.kind = 'roundup_sweep' AND le.amount > 0
      ORDER BY lt.created_at DESC LIMIT $2`,
    [appUserId, limit],
  );
  return rows as RoundupEntry[];
}

/** Tune the caller's own round-up (step ∈ {10,50}, enable/disable). Session-scoped in SQL. */
export async function setSavingsConfig(appUserId: number, step: number, enabled: boolean): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`SELECT set_savings_config($1, $2)`, [step, enabled]);
  }, { userId: appUserId });
}
