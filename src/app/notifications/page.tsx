import Link from "next/link";
import { getViewer } from "@/lib/viewer";
import { redirect } from "next/navigation";
import { listNotifications, unreadCount } from "@/db/notifications";
import { MarkRead } from "./mark-read";

export const dynamic = "force-dynamic";

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function Notifications() {
  const v = await getViewer();
  if (!v) redirect("/login");
  const [items, unread] = await Promise.all([listNotifications(v.appUserId), unreadCount(v.appUserId)]);

  return (
    <main style={{ maxWidth: "40rem" }}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Campus Wallet</div>
          <h1 style={{ fontSize: "1.5rem" }}>Notifications</h1>
        </div>
        {unread > 0 && <MarkRead />}
      </div>
      <p className="sub">{unread > 0 ? `${unread} unread` : "You're all caught up."}</p>

      {items.length === 0 ? (
        <div className="card"><p style={{ color: "var(--muted)", margin: 0 }}>Nothing here yet.</p></div>
      ) : (
        items.map((n) => {
          const body = (
            <div className="card" style={{ marginBottom: "0.8rem", borderLeft: n.read ? undefined : "3px solid var(--accent)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                <strong style={{ fontSize: "0.95rem" }}>{n.title}</strong>
                <span style={{ fontSize: "0.75rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{ago(n.createdAt)}</span>
              </div>
              {n.body && <p style={{ margin: "0.4rem 0 0", fontSize: "0.88rem", color: "var(--muted)" }}>{n.body}</p>}
            </div>
          );
          return n.link ? <Link key={n.notificationId} href={n.link} style={{ textDecoration: "none", color: "inherit" }}>{body}</Link> : <div key={n.notificationId}>{body}</div>;
        })
      )}
    </main>
  );
}
