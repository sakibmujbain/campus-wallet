"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { newIdem } from "@/lib/idem";

export function RedeemForm({ balance, rate }: { balance: number; rate: number }) {
  const router = useRouter();
  const [points, setPoints] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Stable idempotency key per redeem intent; regenerated when the amount changes.
  const [idem, setIdem] = useState<string>(() => newIdem());

  const n = Number(points);
  const valid = Number.isInteger(n) && n > 0 && n <= balance;
  const bdt = Number.isFinite(n) ? n / rate : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) { setMsg({ ok: false, text: `Enter a whole number of points, up to ${balance}.` }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/rewards/redeem", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ points: n, idempotencyKey: idem }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setMsg({ ok: true, text: `Redeemed ${n} points for ৳${bdt.toFixed(2)} — credited to your wallet.` });
        setPoints("");
        setIdem(newIdem());
        router.refresh();
      } else {
        setMsg({ ok: false, text: d.error ?? "Redemption failed." });
      }
    } catch {
      setMsg({ ok: false, text: "Couldn't reach the server — please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Points to redeem (you have {balance.toLocaleString()})
        <input value={points} onChange={(e) => { setPoints(e.target.value); setIdem(newIdem()); }}
          inputMode="numeric" pattern="\d+" placeholder="e.g. 100" />
      </label>
      <p className="sub" style={{ margin: "0.1rem 0 0.4rem" }}>
        {rate} points = ৳1 · you&apos;ll receive <strong>৳{bdt > 0 ? bdt.toFixed(2) : "0.00"}</strong>
      </p>
      <button type="submit" disabled={busy || !valid}>{busy ? "Redeeming…" : "Redeem to wallet"}</button>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} role="status" aria-live="polite">{msg.text}</div>}
    </form>
  );
}
