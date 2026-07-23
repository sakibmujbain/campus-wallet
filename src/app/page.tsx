import Link from "next/link";
import { redirect } from "next/navigation";
import { getStudent } from "@/lib/session";
import { getViewer } from "@/lib/viewer";
import { unreadCount } from "@/db/notifications";
import { money, kycLabel, kycGuidance } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const student = await getStudent();
  if (!student) redirect("/login");
  const viewer = await getViewer();
  const unread = viewer ? await unreadCount(viewer.appUserId) : 0;

  const verified = student.kycStatus === "verified";

  return (
    <main>
      <div className="topbar">
        <div>
          <div className="eyebrow">Campus Wallet</div>
          <h1 style={{ fontSize: "1.5rem" }}>Welcome, {student.fullName.split(" ")[0]}</h1>
        </div>
        <div className="topbar-right">
          <span className={`badge ${verified ? "badge-ok" : "badge-warn"}`}>
            {verified ? "✓ e-KYC verified" : kycLabel(student.kycStatus)}
          </span>
          <Link href="/notifications" className="btn-ghost" title="Notifications"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}>
            🔔{unread > 0 && <span style={{ marginLeft: "0.25rem", color: "var(--accent)", fontWeight: 700 }}>{unread}</span>}
          </Link>
          <Link href="/profile" className="btn-ghost">Profile</Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="btn-ghost">Sign out</button>
          </form>
        </div>
      </div>

      <p className="sub">
        {student.studentNo} · {student.email}{verified && <> — verified via your <code>.edu.bd</code> email.</>}
      </p>
      {!verified && kycGuidance(student.kycStatus) && (
        <div className="msg info" role="status" style={{ marginTop: "1rem" }}>{kycGuidance(student.kycStatus)}</div>
      )}

      {student.duesCount > 0 && (
        <Link href="/dues" className="dues-nudge">
          💳 You owe <strong>{money(student.duesTotal)}</strong> in {student.duesCount} due{student.duesCount > 1 ? "s" : ""} — pay now →
        </Link>
      )}

      <div className="tiles">
        <div className="tile">
          <span className="tile-label">Spending wallet</span>
          <span className="tile-value">{money(student.spending)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Tuition Shield savings</span>
          <span className="tile-value">{money(student.savings)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Loyalty points</span>
          <span className="tile-value">{Number(student.points).toLocaleString()}</span>
        </div>
      </div>

      <h2 style={{ fontSize: "1rem", margin: "2rem 0 1rem" }}>What you can do</h2>
      <div className="features">
        <Link href="/dues" className="feature">
          <span className="feature-icon">💳</span>
          <span className="feature-title">Pay dues</span>
          <span className="feature-desc">Exam, hall, and other fees assessed to you — pay the exact amount.</span>
        </Link>
        <Link href="/top-up" className="feature">
          <span className="feature-icon">➕</span>
          <span className="feature-title">Top up</span>
          <span className="feature-desc">Add balance to your spending wallet (instant demo cash-in).</span>
        </Link>
        <Link href="/hub" className="feature">
          <span className="feature-icon">🏛</span>
          <span className="feature-title">Campus Payment Hub</span>
          <span className="feature-desc">Pay exam fees, hall dues, and cafeteria tills — one tap, zero fees.</span>
        </Link>
        <Link href="/events" className="feature">
          <span className="feature-icon">📅</span>
          <span className="feature-title">Events &amp; Defaulters</span>
          <span className="feature-desc">Club/batch collections with a live, self-updating defaulter list.</span>
        </Link>
        <Link href="/savings" className="feature">
          <span className="feature-icon">🐖</span>
          <span className="feature-title">Tuition Shield (round-ups)</span>
          <span className="feature-desc">Your locked savings, round-up history, and tune the step.</span>
        </Link>
        <Link href="/rewards" className="feature">
          <span className="feature-icon">💎</span>
          <span className="feature-title">Loyalty rewards</span>
          <span className="feature-desc">Redeem points back to BDT and climb the RANK() leaderboard.</span>
        </Link>
      </div>

      {viewer && (viewer.isAdmin || viewer.has("cr") || viewer.has("club_exec")) && (
        <>
          <h2 style={{ fontSize: "1rem", margin: "2rem 0 1rem" }}>Your consoles</h2>
          <div className="features">
            {viewer.isAdmin && (
              <Link href="/admin" className="feature">
                <span className="feature-icon">⚙️</span>
                <span className="feature-title">Admin console</span>
                <span className="feature-desc">Fee catalog, roles, KYC approvals, and system monitoring.</span>
              </Link>
            )}
            {(viewer.has("cr") || viewer.has("club_exec")) && (
              <Link href="/cr" className="feature">
                <span className="feature-icon">📣</span>
                <span className="feature-title">Organizer console</span>
                <span className="feature-desc">Create collection drives and chase defaulters.</span>
              </Link>
            )}
          </div>
        </>
      )}

      <p className="foot" style={{ marginTop: "2.5rem" }}>
        Money moves through an immutable double-entry ledger; balances are derived, not stored.
      </p>
    </main>
  );
}
