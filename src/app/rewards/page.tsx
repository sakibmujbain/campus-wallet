import { redirect } from "next/navigation";
import { getStudent } from "@/lib/session";
import { getLeaderboard, getPoints, getRedeemRate, listPointHistory } from "@/db/rewards";
import { RedeemForm } from "./redeem-form";

export const dynamic = "force-dynamic";

const REASON: Record<string, string> = { purchase: "Earned — campus spending", redeem: "Redeemed to wallet" };

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const d = Math.floor((Date.now() - then) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

export default async function Rewards() {
  const student = await getStudent();
  if (!student) redirect("/login");

  const [pointsStr, history, leaderboard, rate] = await Promise.all([
    getPoints(student.appUserId),
    listPointHistory(student.appUserId),
    getLeaderboard(),
    getRedeemRate(),
  ]);
  const balance = Math.floor(Number(pointsStr));

  return (
    <main>
      <div className="eyebrow">Campus Wallet · Rewards</div>
      <h1>Loyalty rewards</h1>
      <p className="sub">
        Earn points on campus spending — {rate} points convert back to ৳1, paid from the loyalty pool into your
        spending wallet. Balances are a live <code>SUM</code> of an append-only points ledger; the leaderboard is a
        window-<code>RANK()</code> materialized view.
      </p>

      <div className="tiles">
        <div className="tile"><span className="tile-label">Your points</span><span className="tile-value">{balance.toLocaleString()}</span></div>
        <div className="tile"><span className="tile-label">Worth</span><span className="tile-value">৳{(balance / rate).toFixed(2)}</span></div>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Redeem points</h2>
        {balance <= 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No points to redeem yet — spend at a cafeteria till to start earning.</p>
        ) : (
          <RedeemForm balance={balance} rate={rate} />
        )}
      </div>

      <div className="card">
        <h2>Leaderboard</h2>
        {leaderboard.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No ranked students yet.</p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead><tr><th className="num">#</th><th>Student</th><th className="num">Points</th></tr></thead>
              <tbody>
                {leaderboard.map((r) => {
                  const me = r.studentId === student.appUserId;
                  return (
                    <tr key={r.studentId} style={me ? { background: "color-mix(in srgb, var(--accent) 10%, transparent)" } : undefined}>
                      <td className="num">{r.rank}</td>
                      <td>{r.fullName}{me && <span className="kind" style={{ marginLeft: "0.4rem" }}>you</span>}</td>
                      <td className="num">{Math.floor(Number(r.points)).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Point history</h2>
        {history.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>Nothing yet.</p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead><tr><th>Activity</th><th>When</th><th className="num">Points</th></tr></thead>
              <tbody>
                {history.map((h, i) => {
                  const pts = Number(h.points);
                  return (
                    <tr key={i}>
                      <td>{REASON[h.reason] ?? h.reason}</td>
                      <td style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{ago(h.createdAt)}</td>
                      <td className="num" style={{ color: pts >= 0 ? "var(--good)" : "var(--muted)" }}>{pts >= 0 ? "+" : ""}{Math.trunc(pts)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
