import Link from "next/link";
import { listDefaulters, listEventProgress } from "@/db/accounts";
import { money } from "@/lib/format";
import { Progress } from "@/components/progress";

export const dynamic = "force-dynamic";

export default async function Events() {
  let events: Awaited<ReturnType<typeof listEventProgress>> = [];
  let defaulters: Awaited<ReturnType<typeof listDefaulters>> = [];
  let dbError = false;
  try {
    [events, defaulters] = await Promise.all([listEventProgress(), listDefaulters()]);
  } catch (err) {
    console.error("events page load failed:", err);
    dbError = true;
  }

  return (
    <main>
      <div className="eyebrow">Campus Wallet · Events</div>
      <h1>Events &amp; collections</h1>
      <p className="sub">
        Each event is a pooled wallet with a roster. The <strong>defaulter list</strong> is a live view —
        <code>roster EXCEPT fully-paid</code> — so it updates the instant someone pays (and a refund puts them right back).
      </p>

      {dbError ? (
        <div className="card">
          <div className="msg err">We couldn&apos;t load collections right now — please try again in a moment.</div>
        </div>
      ) : (
        events.map((e) => {
          const eventDefaulters = defaulters.filter((d) => d.eventId === e.eventId);
          return (
            <div className="card" key={e.eventId}>
              <h2>
                {e.name} {e.batch && <span className="kind">batch {e.batch}</span>}
              </h2>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
                <span>
                  {money(e.collected)} of {money(e.target)} collected · {e.rosterSize} on roster
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{e.pctCollected ?? "0"}%</span>
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <Progress value={e.pctCollected ? Number(e.pctCollected) : 0} label={`${e.name} collection progress`} />
              </div>

              <h3 style={{ fontSize: "0.82rem", fontFamily: "var(--mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 0.5rem" }}>
                Defaulters ({eventDefaulters.length})
              </h3>
              {eventDefaulters.length === 0 ? (
                <p style={{ color: "var(--good)", fontSize: "0.9rem" }}>Everyone has paid in full. 🎉</p>
              ) : (
                <div className="scroll-x">
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
                </div>
              )}
            </div>
          );
        })
      )}

      {!dbError && events.length === 0 && (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>No active collections right now.</p>
        </div>
      )}

      <p className="foot">
        <Link href="/">← Wallet balances</Link> · <Link href="/my-events">Pay your drives</Link> · <Link href="/hub">Payment hub</Link>
      </p>
    </main>
  );
}
