import Link from "next/link";
import { redirect } from "next/navigation";
import { listPayableTargets } from "@/db/accounts";
import { getStudent } from "@/lib/session";
import { PayForm } from "./pay-form";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { hall: "Hall dues", exam: "Exam fees", cafeteria: "Cafeteria" };

function money(v: string): string {
  const [whole, frac = ""] = v.split(".");
  return `৳${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(frac + "00").slice(0, 2)}`;
}

export default async function Hub() {
  const student = await getStudent();
  if (!student) redirect("/login");

  let targets: Awaited<ReturnType<typeof listPayableTargets>> = [];
  let dbError: string | null = null;
  try {
    targets = await listPayableTargets();
  } catch (err) {
    dbError = (err as Error).message;
  }

  return (
    <main>
      <div className="eyebrow">Campus Wallet · Payment hub</div>
      <h1>Pay a campus bill</h1>
      <p className="sub">
        Paying from your spending wallet — balance <strong>{money(student.spending)}</strong>. Every payment posts
        through the double-entry ledger; the spare change rounds up into your Tuition Shield.
      </p>

      {dbError ? (
        <div className="card">
          <div className="msg err">Could not reach the database: {dbError}</div>
        </div>
      ) : (
        <>
          <div className="card">
            <h2>Payable targets</h2>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Payee</th>
                  <th className="num">Account</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.accountId}>
                    <td><span className="kind">{KIND_LABEL[t.instKind] ?? t.instKind}</span></td>
                    <td>{t.label}</td>
                    <td className="num">#{t.accountId}</td>
                  </tr>
                ))}
                {targets.length === 0 && (
                  <tr><td colSpan={3} style={{ color: "var(--muted)" }}>No payees yet — run <code>npm run db:seed</code>.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Make a payment</h2>
            <PayForm targets={targets} balance={student.spending} />
          </div>
        </>
      )}

      <p className="foot">
        <Link href="/">← Dashboard</Link> · <Link href="/events">Events &amp; defaulters</Link>
      </p>
    </main>
  );
}
