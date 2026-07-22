import Link from "next/link";
import { listAccountsWithBalances } from "@/db/accounts";
import { TransferForm } from "./transfer-form";

// Balances are live-derived from the ledger, so never statically cache this page.
export const dynamic = "force-dynamic";

function formatBalance(value: string): string {
  // value is an exact NUMERIC string like "749.5000"; trim to a display scale
  // without ever converting through a float.
  const [whole, frac = ""] = value.split(".");
  const withGroups = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${withGroups}.${(frac + "00").slice(0, 2)}`;
}

export default async function Home() {
  let accounts: Awaited<ReturnType<typeof listAccountsWithBalances>> = [];
  let dbError: string | null = null;
  try {
    accounts = await listAccountsWithBalances();
  } catch (err) {
    dbError = (err as Error).message;
  }

  return (
    <main>
      <div className="eyebrow">Campus Wallet · Phase 0 · Ledger spine</div>
      <h1>Wallet balances</h1>
      <p className="sub">
        Every balance below is <strong>derived</strong> from the append-only double-entry ledger — not stored.
        A transfer posts two balanced legs inside one atomic, idempotent transaction.
      </p>
      <p style={{ marginBottom: "1.5rem" }}>
        <Link href="/hub">Go to the campus payment hub →</Link>
      </p>

      {dbError ? (
        <div className="card">
          <div className="msg err">Could not reach the database: {dbError}</div>
          <p className="foot">
            Set <code>DATABASE_URL</code> in <code>.env</code>, then run{" "}
            <code>npm run migrate &amp;&amp; npm run db:seed</code>.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <h2>Accounts</h2>
            <table>
              <thead>
                <tr>
                  <th className="num">ID</th>
                  <th>Kind</th>
                  <th>Currency</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.accountId}>
                    <td className="num">{a.accountId}</td>
                    <td>
                      <span className="kind">{a.accountKind}</span>
                    </td>
                    <td>{a.currency}</td>
                    <td className="num">{formatBalance(a.balance)}</td>
                  </tr>
                ))}
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--muted)" }}>
                      No accounts yet — run <code>npm run db:seed</code>.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Make a transfer</h2>
            <TransferForm accounts={accounts} />
          </div>
        </>
      )}

      <p className="foot">
        Guarantees enforced in PostgreSQL: exact <code>NUMERIC</code> money · per-currency zero-sum at COMMIT ·
        append-only ledger · per-account overdraft floor · idempotent replay · <code>SELECT … FOR UPDATE</code> under SERIALIZABLE.
      </p>
    </main>
  );
}
