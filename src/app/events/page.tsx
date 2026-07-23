import Link from "next/link";
import { listDefaulters, listEventProgress } from "@/db/accounts";

export const dynamic = "force-dynamic";

function money(v: string): string {
  const [whole, frac = ""] = v.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(frac + "00").slice(0, 2)}`;
}

export default async function Events() {
  let events: Awaited<ReturnType<typeof listEventProgress>> = [];
  let defaulters: Awaited<ReturnType<typeof listDefaulters>> = [];
  let dbError: string | null = null;
  try {
    [events, defaulters] = await Promise.all([listEventProgress(), listDefaulters()]);
  } catch (err) {
    dbError = (err as Error).message;
  }

  return (
    <main>
      <div className="eyebrow">Campus Wallet · Phase 3 · Event wallets</div>
      <h1>Events &amp; collections</h1>
      <p className="sub">
        Each event is a pooled wallet with a roster. The <strong>defaulter list</strong> is a live view —
        <code>roster EXCEPT fully-paid</code> — so it updates the instant someone pays (and a refund puts them right back).
      </p>

      {dbError ? (
        <div className="card">
          <div className="msg err">Could not reach the database: {dbError}</div>
        </div>
      ) : (
        events.map((e) => {
          const pct = e.pctCollected ? Math.min(100, Number(e.pctCollected)) : 0;
          const eventDefaulters = defaulters.filter((d) => d.eventId === e.eventId);
          return (
            <div className="card" key={e.eventId}>
              <h2>
                {e.name} {e.batch && <span className="kind">batch {e.batch}</span>}
              </h2>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
                <span>
                  ৳{money(e.collected)} of ৳{money(e.target)} collected · {e.rosterSize} on roster
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{e.pctCollected ?? "0"}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden", marginBottom: "1rem" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
              </div>

              <h3 style={{ fontSize: "0.82rem", fontFamily: "var(--mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 0.5rem" }}>
                Defaulters ({eventDefaulters.length})
              </h3>
              {eventDefaulters.length === 0 ? (
                <p style={{ color: "var(--good)", fontSize: "0.9rem" }}>Everyone has paid in full. 🎉</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th className="num">Paid</th>
                      <th className="num">Expected</th>
                      <th className="num">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventDefaulters.map((d) => (
                      <tr key={`${d.eventId}-${d.studentId}`}>
                        <td>{d.studentName}</td>
                        <td className="num">{money(d.paid)}</td>
                        <td className="num">{money(d.expected)}</td>
                        <td className="num" style={{ color: "var(--bad)" }}>{money(d.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}

      {!dbError && events.length === 0 && (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>
            No events yet — run <code>npm run db:seed</code>.
          </p>
        </div>
      )}

      <p className="foot">
        <Link href="/">← Wallet balances</Link> · <Link href="/hub">Payment hub</Link>
      </p>
    </main>
  );
}
