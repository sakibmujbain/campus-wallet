import { listHalls, listPayees } from "@/db/adminops";
import { requireViewer } from "@/lib/viewer";
import { money } from "@/lib/format";
import { NewPayee } from "./new-payee";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { hall: "Hall", exam: "Exam", cafeteria: "Cafeteria" };

export default async function Wallets() {
  await requireViewer("admin"); // re-assert per page (a shared layout guard doesn't re-run on soft nav)
  const [payees, halls] = await Promise.all([listPayees(), listHalls()]);

  return (
    <main>
      <div className="eyebrow">Admin · Payees</div>
      <h1>Campus payees</h1>
      <p className="sub">
        Institutional collection wallets — hall / exam / cafeteria — provisioned through the specialization
        hierarchy (<code>account → institutional_wallet → subtype</code>). These are the destinations a fee&apos;s
        collector points at, and where drives settle.
      </p>

      <div className="card">
        <h2>Provision a payee</h2>
        <NewPayee halls={halls} />
      </div>

      <div className="card">
        <h2>Existing payees ({payees.length})</h2>
        <div className="scroll-x">
          <table style={{ minWidth: "560px" }}>
            <thead><tr><th>Payee</th><th>Kind</th><th>Ccy</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {payees.map((p) => (
                <tr key={p.accountId}>
                  <td>{p.label}<br /><span className="kind">#{p.accountId}</span></td>
                  <td><span className="kind">{KIND_LABEL[p.instKind] ?? p.instKind}</span></td>
                  <td>{p.currency}</td>
                  <td className="num">{money(p.balance)}</td>
                </tr>
              ))}
              {payees.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)" }}>No payees yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
