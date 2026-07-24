import { pool } from "@/db/pool";

export interface Txn {
  entryId: number;
  txnId: number;
  amount: string;      // signed: +credit / -debit
  direction: string;   // 'credit' | 'debit'
  txnType: string;
  kind: string;
  description: string;
  wallet: string;      // 'spending' | 'savings'
  at: string;          // ISO-Z
}

/** The student's own ledger entries across their wallets, newest first. Each row is
 *  one signed leg (the student's side of a transaction). */
export async function listTransactions(appUserId: number, limit = 30): Promise<Txn[]> {
  const { rows } = await pool.query(
    `SELECT le.entry_id::int AS "entryId",
            le.txn_id::int AS "txnId",
            le.amount::text AS amount,
            le.direction,
            le.txn_type AS "txnType",
            lt.kind,
            COALESCE(NULLIF(lt.description, ''), lt.kind) AS description,
            sw.wallet_purpose AS wallet,
            to_char(le.posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "at"
       FROM ledger_entry le
       JOIN ledger_transaction lt ON lt.txn_id = le.txn_id
       JOIN student_wallet sw ON sw.account_id = le.account_id
      WHERE sw.student_id = $1
      ORDER BY le.posted_at DESC, le.entry_id DESC
      LIMIT $2`,
    [appUserId, limit],
  );
  return rows as Txn[];
}
