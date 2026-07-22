import Link from "next/link";
import { listPayableTargets, listStudentSpendingWallets } from "@/db/accounts";
import { PayForm } from "./pay-form";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  hall: "Hall dues",
  exam: "Exam fees",
  cafeteria: "Cafeteria",
};

export default async function Hub() {
  let targets: Awaited<ReturnType<typeof listPayableTargets>> = [];
  let wallets: Awaited<ReturnType<typeof listStudentSpendingWallets>> = [];
  let dbError: string | null = null;
  try {
    [targets, wallets] = await Promise.all([listPayableTargets(), listStudentSpendingWallets()]);
  } catch (err) {
    dbError = (err as Error).message;
  }

  return (
    <main>
      <div className="eyebrow">Campus Wallet · Phase 1 · Payment hub</div>
      <h1>Pay a campus bill</h1>
      <p className="sub">
        One interface over every institutional payee — hall dues, exam fees, cafeteria tills — each a distinct
        subtype of a single <code>account</code> superclass. Payments post through the same double-entry ledger.
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
                    <td>
                      <span className="kind">{KIND_LABEL[t.instKind] ?? t.instKind}</span>
                    </td>
                    <td>{t.label}</td>
                    <td className="num">#{t.accountId}</td>
                  </tr>
                ))}
                {targets.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: "var(--muted)" }}>
                      No payees yet — run <code>npm run db:seed</code>.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Make a payment</h2>
            <PayForm wallets={wallets} targets={targets} />
          </div>
        </>
      )}

      <p className="foot">
        <Link href="/">← Back to wallet balances</Link>
      </p>
    </main>
  );
}
