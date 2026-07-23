import { cache } from "react";
import { pool } from "@/db/pool";
import { getViewer } from "@/lib/viewer";

export interface Student {
  appUserId: number;
  email: string;
  fullName: string;
  studentNo: string;
  kycStatus: string;
  spending: string;
  savings: string;
  points: string;
}

// Resolves the authenticated Supabase user, idempotently provisions their
// app_user/student/wallets, and returns a dashboard summary. Cached per request.
export const getStudent = cache(async (): Promise<Student | null> => {
  const v = await getViewer(); // resolves + provisions the app_user (any role)
  if (!v) return null;
  const appUserId = v.appUserId;

  const { rows: sum } = await pool.query(
    `SELECT au.full_name,
            st.student_no,
            COALESCE((SELECT status FROM kyc_verification WHERE student_id = $1 ORDER BY verification_id DESC LIMIT 1), 'pending') AS kyc_status,
            COALESCE((SELECT b.balance FROM student_wallet sw JOIN account_balance b ON b.account_id = sw.account_id
                       WHERE sw.student_id = $1 AND sw.wallet_purpose = 'spending'), 0)::text AS spending,
            COALESCE((SELECT b.balance FROM student_wallet sw JOIN account_balance b ON b.account_id = sw.account_id
                       WHERE sw.student_id = $1 AND sw.wallet_purpose = 'savings'), 0)::text AS savings,
            COALESCE((SELECT points FROM v_point_balance WHERE student_id = $1), 0)::text AS points
       FROM app_user au
       JOIN student st ON st.student_id = au.user_id
      WHERE au.user_id = $1`,
    [appUserId],
  );
  if (!sum[0]) return null; // linked to a non-student app_user (no student row) — treat as unauthenticated
  const r = sum[0];
  return {
    appUserId,
    email: v.email,
    fullName: r.full_name,
    studentNo: r.student_no,
    kycStatus: r.kyc_status,
    spending: r.spending,
    savings: r.savings,
    points: r.points,
  };
});

/** The logged-in student's spending wallet account id (server-derived, never trusted from the client). */
export async function getSpendingAccountId(appUserId: number): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT account_id::int AS id FROM student_wallet WHERE student_id = $1 AND wallet_purpose = 'spending'`,
    [appUserId],
  );
  return rows[0]?.id ?? null;
}
