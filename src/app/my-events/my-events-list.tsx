"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { money } from "@/lib/format";
import { newIdem } from "@/lib/idem";
import { Progress } from "@/components/progress";
import { Icon } from "@/components/icon";
import { FormattedText } from "@/components/rich-text";
import { Donut, DonutLegend, type Slice } from "@/components/donut";

interface MyEvent {
  eventId: number; name: string; batch: string | null; status: string;
  description: string | null; deadline: string | null; organizer: string | null;
  expected: string; paid: string; outstanding: string;
  target: string; collected: string;
  rosterSize: number; paidCount: number; partialCount: number;
}
interface Participant {
  eventId: number; fullName: string; studentNo: string | null; expected: string; paid: string;
}

/** Whole days until a date, or null when there's no deadline. */
function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  const due = new Date(deadline.slice(0, 10) + "T00:00:00Z").getTime();
  if (Number.isNaN(due)) return null;
  return Math.ceil((due - Date.now()) / 86400000);
}

export function MyEventsList({ events, participants }: { events: MyEvent[]; participants: Participant[] }) {
  if (events.length === 0) {
    return (
      <div className="card">
        <p style={{ color: "var(--muted)", margin: 0 }}>You&apos;re not on any collection drives right now.</p>
      </div>
    );
  }
  return (
    <>
      {events.map((e) => (
        <EventCard key={e.eventId} e={e} people={participants.filter((p) => p.eventId === e.eventId)} />
      ))}
    </>
  );
}

function EventCard({ e, people }: { e: MyEvent; people: Participant[] }) {
  const router = useRouter();
  const out = Number(e.outstanding);
  const payable = e.status === "open" && out > 0;

  const [amount, setAmount] = useState(e.outstanding);
  // Stable idempotency key per payment intent; regenerated when the amount changes.
  const [idem, setIdem] = useState<string>(() => newIdem());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showPeople, setShowPeople] = useState(false);

  const collectedPct = Number(e.target) > 0 ? (Number(e.collected) / Number(e.target)) * 100 : 0;
  const unpaidCount = Math.max(e.rosterSize - e.paidCount - e.partialCount, 0);
  const slices: Slice[] = [
    { label: "Paid in full", value: e.paidCount, tone: "good" },
    { label: "Partly paid", value: e.partialCount, tone: "info" },
    { label: "Not paid yet", value: unpaidCount, tone: "bad" },
  ];
  const left = daysLeft(e.deadline);

  async function pay(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/events/pay", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: e.eventId, amount, idempotencyKey: idem }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setMsg({ ok: true, text: `Paid ${money(amount)} — transaction #${d.txn}.` });
        setIdem(newIdem());
        router.refresh();
      } else {
        const overdraft = /overdraft floor|not enough|insufficient/i.test(d.error ?? "");
        setMsg({ ok: false, text: overdraft ? "Not enough balance — top up your wallet and try again." : (d.error ?? "Payment failed.") });
      }
    } catch {
      setMsg({ ok: false, text: "Couldn't reach the server — please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="topbar" style={{ marginBottom: "0.35rem" }}>
        <div>
          <h2 style={{ margin: 0 }}>{e.name}</h2>
          <p className="sub" style={{ margin: "0.25rem 0 0", fontSize: "0.82rem" }}>
            {e.batch && <span className="kind">batch {e.batch}</span>}{" "}
            {e.organizer && <>organised by {e.organizer}</>}
          </p>
        </div>
        <span className={`badge ${e.status === "open" ? "badge-ok" : "kind"}`}>{e.status}</span>
      </div>

      {/* Deadline: the thing that decides whether you act today */}
      {e.deadline && (
        <p className={`deadline ${left !== null && left <= 3 ? "is-soon" : ""}`}>
          <Icon name="calendar" className="ico-inline" />
          {left === null ? `Due ${e.deadline.slice(0, 10)}`
            : left < 0 ? `Deadline passed — was ${e.deadline.slice(0, 10)}`
            : left === 0 ? `Due today (${e.deadline.slice(0, 10)})`
            : `${left} day${left === 1 ? "" : "s"} left — due ${e.deadline.slice(0, 10)}`}
        </p>
      )}

      {e.description && <FormattedText text={e.description} className="desc-rich" />}

      {/* Your position — the number this page exists to answer */}
      <div className="my-share">
        <div>
          <span className="tile-label">Your share</span>
          <span className="share-value" style={{ color: out > 0 ? "var(--bad)" : "var(--good)" }}>
            {out > 0 ? money(e.outstanding) : <><Icon name="check" className="ico-inline" /> Paid in full</>}
          </span>
          <span className="kind">{money(e.paid)} paid of {money(e.expected)}</span>
        </div>
        {payable ? (
          <form onSubmit={pay} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ flex: "0 0 8.5rem" }}>
              Amount (৳)
              <input value={amount} onChange={(ev) => { setAmount(ev.target.value); setIdem(newIdem()); }}
                inputMode="decimal" pattern="^\d+(\.\d{1,4})?$" title="A positive amount, up to 4 decimals" required />
            </label>
            <button type="submit" disabled={busy}>{busy ? "Paying…" : "Pay"}</button>
          </form>
        ) : e.status !== "open" ? (
          <p className="sub" style={{ margin: 0 }}>This drive is {e.status} — no longer accepting payments.</p>
        ) : null}
      </div>

      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} role="status" aria-live="polite">{msg.text}</div>}

      {/* How the drive as a whole is doing */}
      <div className="drive-stats">
        <div className="drive-chart">
          <Donut slices={slices} centerTop={`${Math.round(collectedPct)}%`} centerSub="collected" />
          <DonutLegend slices={slices} />
        </div>
        <div className="drive-figures">
          <div>
            <span className="tile-label">Collected</span>
            <span className="tile-value">{money(e.collected)}</span>
            <span className="kind">of {money(e.target)} target</span>
          </div>
          <Progress value={collectedPct} label={`${e.name} — collected so far`} />
          <p className="kind" style={{ margin: 0 }}>
            {e.paidCount} of {e.rosterSize} people have paid in full
            {e.partialCount > 0 && `, ${e.partialCount} part-way`}.
          </p>
        </div>
      </div>

      {/* Who else is on it — a table view is also the chart's accessible fallback */}
      <button type="button" className="btn-ghost" onClick={() => setShowPeople((v) => !v)}
        aria-expanded={showPeople}>
        {showPeople ? "Hide" : "Show"} everyone on this drive ({e.rosterSize})
      </button>
      {showPeople && (
        <div className="scroll-x participant-list">
          <table>
            <thead><tr><th>Student</th><th className="num">Paid</th><th className="num">Of</th><th>Status</th></tr></thead>
            <tbody>
              {people.map((p) => {
                const owe = Number(p.expected) - Number(p.paid);
                const tone = owe <= 0 ? "good" : Number(p.paid) > 0 ? "info" : "bad";
                const text = owe <= 0 ? "Paid" : Number(p.paid) > 0 ? `${money(String(owe))} left` : "Not paid";
                return (
                  <tr key={`${p.eventId}-${p.fullName}-${p.studentNo}`}>
                    <td>{p.fullName}<br /><span className="kind">{p.studentNo ?? "—"}</span></td>
                    <td className="num">{money(p.paid)}</td>
                    <td className="num">{money(p.expected)}</td>
                    <td><span className={`dv-chip dv-${tone}`}>{text}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
