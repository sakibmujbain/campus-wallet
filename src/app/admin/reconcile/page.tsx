import { listDrift, systemSnapshot } from "@/db/adminops";
import { requireViewer } from "@/lib/viewer";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Reconcile() {
  await requireViewer("admin"); // re-assert per page (a shared layout guard doesn't re-run on soft nav)
  const [snap, drift] = await Promise.all([systemSnapshot(), listDrift()]);

  return (
    <main>
      <div className="eyebrow">Admin · Monitoring</div>
      <h1>Reconciliation</h1>
      <p className="sub">
        Balances are <strong>derived</strong> from the immutable ledger; the <code>account_balance</code> cache is a
        trigger-maintained optimization. This runs <code>reconcile_balances()</code> — a <code>FULL OUTER JOIN</code>
        of the cache against <code>SUM(ledger_entry)</code> per account — and lists every row where they disagree.
        A healthy system returns zero.
      </p>

      <div className="tiles">
        <div className="tile"><span className="tile-label">Accounts</span><span className="tile-value">{snap.accounts}</span></div>
        <div className="tile">
          <span className="tile-label">Ledger drift</span>
          <span className="tile-value" style={{ color: snap.drift === 0 ? "var(--good)" : "var(--bad)" }}>{snap.drift}</span>
        </div>
        <div className="tile"><span className="tile-label">Treasury</span><span className="tile-value">{money(snap.treasury)}</span></div>
        <div className="tile"><span className="tile-label">Loyalty pool</span><span className="tile-value">{money(snap.loyaltyPool)}</span></div>
        <div className="tile"><span className="tile-label">External rail</span><span className="tile-value">{money(snap.external)}</span></div>
        <div className="tile"><span className="tile-label">Audit rows</span><span className="tile-value">{snap.auditRows.toLocaleString()}</span></div>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2>reconcile_balances()</h2>
        {drift.length === 0 ? (
          <p style={{ color: "var(--good)", margin: 0 }}>
            ✓ The cache reconciles exactly with the ledger — <strong>0 drift rows</strong>. Every derived balance equals <code>SUM(ledger_entry)</code>.
          </p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead><tr><th>Account</th><th>Currency</th><th className="num">Cached</th><th className="num">Ledger</th><th className="num">Diff</th></tr></thead>
              <tbody>
                {drift.map((d) => (
                  <tr key={`${d.accountId}-${d.currency}`}>
                    <td>#{d.accountId}</td>
                    <td>{d.currency}</td>
                    <td className="num">{d.cached ?? "—"}</td>
                    <td className="num">{d.ledger ?? "—"}</td>
                    <td className="num" style={{ color: "var(--bad)" }}>{d.diff.startsWith("-") ? "" : "+"}{d.diff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="foot">Reload to re-run the reconciliation.</p>
    </main>
  );
}
