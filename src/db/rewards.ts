import { pool } from "@/db/pool";
import { withTransaction } from "@/db/tx";

export interface PointEntry { points: string; reason: string; createdAt: string }
export interface LeaderRow { studentId: number; fullName: string; points: string; rank: number }

/** Derived point balance (SUM of the append-only point_ledger). */
export async function getPoints(appUserId: number): Promise<string> {
  const { rows } = await pool.query(`SELECT COALESCE(points, 0)::text AS p FROM v_point_balance WHERE student_id = $1`, [appUserId]);
  return rows[0]?.p ?? "0";
}

export async function listPointHistory(appUserId: number, limit = 20): Promise<PointEntry[]> {
  const { rows } = await pool.query(
    // Emit a JS-parseable ISO-Z string (a bare '+00' offset text-cast is Invalid Date in V8).
    `SELECT points::text, reason,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
       FROM point_ledger WHERE student_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [appUserId, limit],
  );
  return rows as PointEntry[];
}

/** Top of the RANK() leaderboard — reads the matview directly. It's kept current by
 *  the hourly pg_cron refresh and by redeemPoints() refreshing after each redemption,
 *  so we do NOT pay a CONCURRENTLY rebuild on every page load. */
export async function getLeaderboard(limit = 10): Promise<LeaderRow[]> {
  const { rows } = await pool.query(
    `SELECT student_id::int AS "studentId", full_name AS "fullName", points::text, rank::int
       FROM mv_loyalty_leaderboard ORDER BY rank, full_name LIMIT $1`,
    [limit],
  );
  return rows as LeaderRow[];
}

/** Redemption conversion: points per 1 BDT (default 100 → 100 pts = ৳1). */
export async function getRedeemRate(): Promise<number> {
  const { rows } = await pool.query(`SELECT conversion_rate::float8 AS r FROM loyalty_rule WHERE reason = 'redeem'`);
  return Number(rows[0]?.r ?? 100);
}

/** Atomic points → BDT redemption (payer is the session student). Idempotent by key. */
export async function redeemPoints(appUserId: number, points: number, idem: string): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(`SELECT redeem_points($1, $2, $3::uuid)`, [appUserId, points, idem]);
  }, { userId: appUserId, isolation: "serializable" });
  // Refresh the RANK() matview off the transaction (REFRESH CONCURRENTLY can't run inside
  // one) so the reloaded leaderboard reflects this redemption. Best-effort.
  try {
    await pool.query(`SELECT refresh_leaderboard()`);
  } catch (e) {
    console.error("leaderboard refresh after redeem failed:", e);
  }
}
