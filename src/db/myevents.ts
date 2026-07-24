import { pool } from "@/db/pool";
import { withTransaction } from "@/db/tx";

export interface MyEvent {
  eventId: number;
  name: string;
  batch: string | null;
  status: string;
  expected: string;
  paid: string;
  outstanding: string;
}

/** The collection drives the student is on the roster for, with what they owe. */
export async function listMyEvents(appUserId: number): Promise<MyEvent[]> {
  const { rows } = await pool.query(
    `SELECT e.event_id::int AS "eventId", e.name, e.batch, e.status,
            r.expected_amount::text AS expected,
            COALESCE(p.paid, 0)::text AS paid,
            (r.expected_amount - COALESCE(p.paid, 0))::text AS outstanding
       FROM event_roster r
       JOIN event e ON e.event_id = r.event_id
       LEFT JOIN (SELECT event_id, student_id, SUM(amount) AS paid
                    FROM event_contribution GROUP BY event_id, student_id) p
              ON p.event_id = r.event_id AND p.student_id = r.student_id
      WHERE r.student_id = $1
      ORDER BY e.event_id DESC`,
    [appUserId],
  );
  return rows as MyEvent[];
}

/** Pay into an event from the SESSION student's spending wallet (server-derived —
 *  the client never supplies an account). pay_event() enforces open-status,
 *  overdraft floor, and idempotency by key. */
export async function payEvent(appUserId: number, eventId: number, amount: string, idem: string): Promise<string> {
  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT account_id FROM student_wallet WHERE student_id = $1 AND wallet_purpose = 'spending'`,
      [appUserId],
    );
    const acct = rows[0]?.account_id;
    if (!acct) {
      const e = new Error("you don't have a spending wallet") as Error & { code?: string };
      e.code = "P0001";
      throw e;
    }
    const { rows: r } = await c.query(
      `SELECT pay_event($1, $2, $3::numeric, $4::uuid, 'event payment') AS txn`,
      [acct, eventId, amount, idem],
    );
    return String(r[0].txn);
  }, { userId: appUserId, isolation: "serializable" });
}
