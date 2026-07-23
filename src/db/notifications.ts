import { pool } from "@/db/pool";
import { withTransaction } from "@/db/tx";

export interface Notification {
  notificationId: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export async function listNotifications(appUserId: number, limit = 50): Promise<Notification[]> {
  const { rows } = await pool.query(
    `SELECT notification_id::int AS "notificationId", kind, title, body, link,
            (read_at IS NOT NULL) AS read, created_at::text AS "createdAt"
       FROM notification WHERE user_id = $1
      ORDER BY created_at DESC, notification_id DESC
      LIMIT $2`,
    [appUserId, limit],
  );
  return rows as Notification[];
}

export async function unreadCount(appUserId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND read_at IS NULL`,
    [appUserId],
  );
  return Number(rows[0].n);
}

/** Marks the caller's unread notifications read (identity derived server-side from the GUC). */
export async function markAllRead(appUserId: number): Promise<number> {
  return withTransaction(async (c) => {
    const { rows } = await c.query(`SELECT mark_notifications_read() AS n`);
    return Number(rows[0].n);
  }, { userId: appUserId });
}
