import { pool } from "@/db/pool";
import { withTransaction } from "@/db/tx";

export interface Due {
  assessmentId: number;
  name: string;
  category: string;
  period: string;
  amount: string;
  status: string;
}

export async function listOpenDues(appUserId: number): Promise<Due[]> {
  const { rows } = await pool.query(
    `SELECT assessment_id::int AS "assessmentId", name, category, period, amount_due::text AS amount, status
       FROM v_student_dues WHERE student_id = $1 AND status = 'open' ORDER BY assessment_id`,
    [appUserId],
  );
  return rows as Due[];
}

export async function listPaidDues(appUserId: number): Promise<Due[]> {
  const { rows } = await pool.query(
    `SELECT assessment_id::int AS "assessmentId", name, category, period, amount_due::text AS amount, status
       FROM v_student_dues WHERE student_id = $1 AND status = 'paid' ORDER BY assessment_id DESC LIMIT 20`,
    [appUserId],
  );
  return rows as Due[];
}

/** Pay a due at its exact snapshot amount. Payer derived server-side from the GUC. */
export async function payDue(appUserId: number, assessmentId: number, idem: string): Promise<string> {
  return withTransaction(
    async (c) => {
      const { rows } = await c.query(`SELECT pay_fee($1, $2::uuid) AS txn`, [assessmentId, idem]);
      return String(rows[0].txn);
    },
    { userId: appUserId, isolation: "serializable" },
  );
}

/** Self-service demo top-up (credits the caller's spending wallet from the external rail). */
export async function topUp(appUserId: number, amount: string, idem: string): Promise<string> {
  return withTransaction(
    async (c) => {
      const { rows } = await c.query(`SELECT top_up($1::numeric, $2::uuid) AS txn`, [amount, idem]);
      return String(rows[0].txn);
    },
    { userId: appUserId, isolation: "serializable" },
  );
}
