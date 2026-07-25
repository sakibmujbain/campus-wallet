import { redirect } from "next/navigation";
import { getStudent } from "@/lib/session";
import { Icon } from "@/components/icon";
import { getSavingsDetail, listRoundupHistory } from "@/db/savings";
import { money } from "@/lib/format";
import { SavingsConfig } from "./savings-config";

export const dynamic = "force-dynamic";

function lockInfo(lockedUntil: string | null): { locked: boolean; text: string } {
  if (!lockedUntil) return { locked: false, text: "Not locked" };
  const until = new Date(lockedUntil.slice(0, 10) + "T00:00:00Z");
  const days = Math.ceil((until.getTime() - Date.now()) / 86400000);
  if (days <= 0) return { locked: false, text: `Unlocked (${lockedUntil.slice(0, 10)})` };
  return { locked: true, text: `Locked until ${lockedUntil.slice(0, 10)} · ${days} day${days === 1 ? "" : "s"} left` };
}

export default async function Savings() {
  const student = await getStudent();
  if (!student) redirect("/login");

  const [detail, history] = await Promise.all([
    getSavingsDetail(student.appUserId),
    listRoundupHistory(student.appUserId),
  ]);
  const lock = lockInfo(detail.lockedUntil);

  return (
    <main>
      <div className="eyebrow">Campus Wallet · Tuition Shield</div>
      <h1>Tuition Shield savings</h1>
      <p className="sub">
        Every purchase rounds up to the nearest ৳{detail.step}; the spare change is swept into a <strong>locked</strong>
        savings wallet you can&apos;t dip into until the term ends — a painless way to save toward tuition.
      </p>

      <div className="tiles">
        <div className="tile"><span className="tile-label">Saved so far</span><span className="tile-value">{money(detail.balance)}</span></div>
        <div className="tile">
          <span className="tile-label">Lock status</span>
          <span className="tile-value" style={{ fontSize: "0.95rem", color: lock.locked ? "var(--accent)" : "var(--good)" }}>{lock.locked ? <><Icon name="lock" className="ico-inline" /> {lock.text}</> : lock.text}</span>
        </div>
        <div className="tile"><span className="tile-label">Rounded up ({detail.roundupCount})</span><span className="tile-value">{money(detail.roundupTotal)}</span></div>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>Round-up settings</h2>
        <SavingsConfig enabled={detail.enabled} step={detail.step} />
      </div>

      <div className="card">
        <h2>Round-up history</h2>
        {history.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            No round-ups yet — {detail.enabled ? "make a cafeteria purchase" : "turn on round-ups above"} to start saving.
          </p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead><tr><th>From</th><th>When</th><th className="num">Swept</th></tr></thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td>{h.description ?? "Round-up"}</td>
                    <td style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{h.createdAt.slice(0, 10)}</td>
                    <td className="num" style={{ color: "var(--good)" }}>+{money(h.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
