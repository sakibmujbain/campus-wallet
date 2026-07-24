"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { money } from "@/lib/format";
import { newIdem } from "@/lib/idem";
import { Progress } from "@/components/progress";

interface MyEvent {
  eventId: number; name: string; batch: string | null; status: string;
  expected: string; paid: string; outstanding: string;
}

export function MyEventsList({ events }: { events: MyEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="card">
        <p style={{ color: "var(--muted)", margin: 0 }}>You&apos;re not on any collection drives right now.</p>
      </div>
    );
  }
  return <>{events.map((e) => <EventCard key={e.eventId} e={e} />)}</>;
}

function EventCard({ e }: { e: MyEvent }) {
  const router = useRouter();
  const out = Number(e.outstanding);
  const payable = e.status === "open" && out > 0;

  const [amount, setAmount] = useState(e.outstanding);
  // Stable idempotency key per payment intent; regenerated when the amount changes.
  const [idem, setIdem] = useState<string>(() => newIdem());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pct = Number(e.expected) > 0 ? (Number(e.paid) / Number(e.expected)) * 100 : 0;

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>{e.name} {e.batch && <span className="kind">batch {e.batch}</span>}</h2>
        <span className={`badge ${e.status === "open" ? "badge-ok" : "kind"}`}>{e.status}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "var(--muted)", margin: "0.5rem 0 0.4rem" }}>
        <span>Paid {money(e.paid)} of {money(e.expected)}</span>
        <span className="num" style={{ color: out > 0 ? "var(--bad)" : "var(--good)" }}>
          {out > 0 ? `${money(e.outstanding)} due` : "paid in full 🎉"}
        </span>
      </div>
      <Progress value={pct} label={`${e.name} — your contribution`} />

      {payable ? (
        <form onSubmit={pay} style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ flex: "0 0 9rem" }}>
            Amount (৳)
            <input value={amount} onChange={(ev) => { setAmount(ev.target.value); setIdem(newIdem()); }}
              inputMode="decimal" pattern="^\d+(\.\d{1,4})?$" title="A positive amount, up to 4 decimals" required />
          </label>
          <button type="submit" disabled={busy}>{busy ? "Paying…" : "Pay"}</button>
        </form>
      ) : e.status !== "open" ? (
        <p className="sub" style={{ marginTop: "0.6rem" }}>This drive is {e.status} — no longer accepting payments.</p>
      ) : null}

      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} role="status" aria-live="polite" style={{ marginTop: "0.6rem" }}>{msg.text}</div>}
    </div>
  );
}
