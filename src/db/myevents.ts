import { pool } from "@/db/pool";
import { withTransaction } from "@/db/tx";

export interface MyEvent {
  eventId: number;
  name: string;
  batch: string | null;
  status: string;
  description: string | null;
  deadline: string | null;
  organizer: string | null;
  /** this student's own position */
  expected: string;
  paid: string;
  outstanding: string;
  /** whole-drive totals, so the student sees the drive's health, not just their bill */
  target: string;
  collected: string;
  rosterSize: number;
  paidCount: number;
  partialCount: number;
}

/** The collection drives the student is on the roster for: their own share plus the
 *  drive's own totals. One query — the per-drive aggregate rides along in a LATERAL so
 *  rendering N drives never becomes N+1 round-trips. */
export async function listMyEvents(appUserId: number): Promise<MyEvent[]> {
  const { rows } = await pool.query(
    `WITH paid AS (
        SELECT event_id, student_id, SUM(amount) AS paid
          FROM event_contribution GROUP BY event_id, student_id)
     SELECT e.event_id::int AS "eventId", e.name, e.batch, e.status,
            e.description, e.deadline::text AS deadline,
            org.full_name AS organizer,
            r.expected_amount::text AS expected,
            COALESCE(p.paid, 0)::text AS paid,
            (r.expected_amount - COALESCE(p.paid, 0))::text AS outstanding,
            agg.target::text    AS target,
            agg.collected::text AS collected,
            agg.roster_size     AS "rosterSize",
            agg.paid_count      AS "paidCount",
            agg.partial_count   AS "partialCount"
       FROM event_roster r
       JOIN event e ON e.event_id = r.event_id
       LEFT JOIN app_user org ON org.user_id = e.organizer_user_id
       LEFT JOIN paid p ON p.event_id = r.event_id AND p.student_id = r.student_id
       JOIN LATERAL (
            SELECT COALESCE(SUM(r2.expected_amount), 0)      AS target,
                   COALESCE(SUM(COALESCE(p2.paid, 0)), 0)    AS collected,
                   count(*)::int                             AS roster_size,
                   count(*) FILTER (WHERE COALESCE(p2.paid, 0) >= r2.expected_amount)::int AS paid_count,
                   count(*) FILTER (WHERE COALESCE(p2.paid, 0) > 0
                                      AND COALESCE(p2.paid, 0) < r2.expected_amount)::int  AS partial_count
              FROM event_roster r2
              LEFT JOIN paid p2 ON p2.event_id = r2.event_id AND p2.student_id = r2.student_id
             WHERE r2.event_id = e.event_id
       ) agg ON true
      WHERE r.student_id = $1
      ORDER BY e.event_id DESC`,
    [appUserId],
  );
  return rows as MyEvent[];
}

export interface Participant {
  eventId: number;
  fullName: string;
  studentNo: string | null;
  expected: string;
  paid: string;
}

/** Everyone on the rosters of the drives THIS student is on. The membership gate is the
 *  IN (...) subquery: a student can only ever read participants of a drive they belong to,
 *  never an arbitrary event_id. */
export async function listMyEventParticipants(appUserId: number): Promise<Participant[]> {
  const { rows } = await pool.query(
    `SELECT r.event_id::int AS "eventId",
            au.full_name    AS "fullName",
            st.student_no   AS "studentNo",
            r.expected_amount::text AS expected,
            COALESCE(p.paid, 0)::text AS paid
       FROM event_roster r
       JOIN app_user au ON au.user_id    = r.student_id
       JOIN student  st ON st.student_id = r.student_id
       LEFT JOIN (SELECT event_id, student_id, SUM(amount) AS paid
                    FROM event_contribution GROUP BY event_id, student_id) p
              ON p.event_id = r.event_id AND p.student_id = r.student_id
      WHERE r.event_id IN (SELECT event_id FROM event_roster WHERE student_id = $1)
      ORDER BY au.full_name`,
    [appUserId],
  );
  return rows as Participant[];
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
