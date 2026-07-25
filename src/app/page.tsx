import Link from "next/link";
import { redirect } from "next/navigation";
import { getStudent } from "@/lib/session";
import { getViewer } from "@/lib/viewer";
import { unreadCount } from "@/db/notifications";
import { money, kycLabel, kycGuidance } from "@/lib/format";
import { Bell } from "@/components/bell";
import { Amount } from "@/components/amount";
import { CoinDoodle } from "@/components/doodle";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const student = await getStudent();
  if (!student) redirect("/login");
  const viewer = await getViewer();
  const unread = viewer ? await unreadCount(viewer.appUserId) : 0;

  const verified = student.kycStatus === "verified";

  return (
    <main className="dashboard">
      <div className="topbar">
        <div>
          <div className="eyebrow">Dashboard</div>
          <h1 style={{ fontSize: "1.65rem" }}>Welcome, {student.fullName.split(" ")[0]}</h1>
        </div>
        <div className="topbar-right">
          <span className={`badge ${verified ? "badge-ok" : "badge-warn"}`}>
            {verified ? "✓ e-KYC verified" : kycLabel(student.kycStatus)}
          </span>
          <Bell count={unread} />
          <Link href="/profile" className="btn-ghost">Profile</Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="btn-ghost">Sign out</button>
          </form>
        </div>
      </div>

      <p className="sub" style={verified ? { marginBottom: "0.3rem" } : undefined}>
        {student.studentNo} · {student.email}
      </p>
      {verified && (
        <p className="verify-note">
          <span className="verify-check" aria-hidden="true">✓</span>
          Verified through your <span className="hl">.edu.bd</span> student email
        </p>
      )}
      {!verified && kycGuidance(student.kycStatus) && (
        <div className="msg info" role="status" style={{ marginTop: "1rem" }}>{kycGuidance(student.kycStatus)}</div>
      )}

      <div className="hero-grid">
        <div className="balance doodle-panel">
          <CoinDoodle style={{ position: "absolute", right: "-6px", top: "-12px", width: "104px", height: "104px", opacity: 0.55, pointerEvents: "none" }} />
          <span className="balance-label">Spending wallet</span>
          <div className="balance-value"><Amount value={student.spending} /></div>
          <span className="balance-brand">Campus Wallet</span>
        </div>
        <div className="hero-side">
          {student.duesCount > 0 && (
            <Link href="/dues" className="dues-nudge">
              <Icon name="card" className="ico-inline" /> You owe <strong>{money(student.duesTotal)}</strong> in {student.duesCount} due{student.duesCount > 1 ? "s" : ""} — pay now →
            </Link>
          )}
          <div className="tiles hero-tiles">
            <div className="tile">
              <span className="tile-label">Tuition Shield savings</span>
              <span className="tile-value">{money(student.savings)}</span>
            </div>
            <div className="tile">
              <span className="tile-label">Loyalty points</span>
              <span className="tile-value">{Number(student.points).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: "1rem", margin: "1.75rem 0 1rem" }}>What you can do</h2>
      <div className="features">
        <Link href="/dues" className="feature">
          <Icon name="card" />
          <span className="feature-title">Pay dues</span>
          <span className="feature-desc">Exam, hall, and other fees assessed to you — pay the exact amount.</span>
        </Link>
        <Link href="/top-up" className="feature">
          <Icon name="plus" />
          <span className="feature-title">Top up</span>
          <span className="feature-desc">Add balance to your spending wallet (instant demo cash-in).</span>
        </Link>
        <Link href="/hub" className="feature">
          <Icon name="bank" />
          <span className="feature-title">Campus Payment Hub</span>
          <span className="feature-desc">Pay exam fees, hall dues, and cafeteria tills — one tap, zero fees.</span>
        </Link>
        <Link href="/my-events" className="feature">
          <Icon name="calendar" />
          <span className="feature-title">My collections</span>
          <span className="feature-desc">Pay your batch drives, see who else is on them, and track progress.</span>
        </Link>
        <Link href="/savings" className="feature">
          <Icon name="shield" />
          <span className="feature-title">Tuition Shield (round-ups)</span>
          <span className="feature-desc">Your locked savings, round-up history, and tune the step.</span>
        </Link>
        <Link href="/rewards" className="feature">
          <Icon name="gem" />
          <span className="feature-title">Loyalty rewards</span>
          <span className="feature-desc">Redeem points back to BDT and climb the RANK() leaderboard.</span>
        </Link>
      </div>

      {viewer && (viewer.isAdmin || viewer.has("cr") || viewer.has("club_exec")) && (
        <>
          <h2 style={{ fontSize: "1rem", margin: "1.75rem 0 1rem" }}>Your consoles</h2>
          <div className="features">
            {viewer.isAdmin && (
              <Link href="/admin" className="feature">
                <Icon name="sliders" />
                <span className="feature-title">Admin console</span>
                <span className="feature-desc">Fee catalog, roles, KYC approvals, and system monitoring.</span>
              </Link>
            )}
            {(viewer.has("cr") || viewer.has("club_exec")) && (
              <Link href="/cr" className="feature">
                <Icon name="megaphone" />
                <span className="feature-title">Organizer console</span>
                <span className="feature-desc">Create collection drives and chase defaulters.</span>
              </Link>
            )}
          </div>
        </>
      )}

      <p className="foot" style={{ marginTop: "2rem" }}>
        Money moves through an immutable double-entry ledger; balances are derived, not stored.
      </p>
    </main>
  );
}
