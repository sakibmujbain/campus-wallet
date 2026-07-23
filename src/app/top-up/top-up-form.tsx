"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TopUpForm() {
  const router = useRouter();
  const [amount, setAmount] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/top-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, idempotencyKey: crypto.randomUUID() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMsg({ ok: true, text: `Added ৳${amount} to your wallet.` });
        router.refresh();
      } else {
        setMsg({ ok: false, text: data.error ?? "Top-up failed." });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.6rem", flexWrap: "wrap" }}>
        {["500", "1000", "2000", "5000"].map((a) => (
          <button type="button" key={a} className="tab" style={{ flex: "1 1 auto" }} onClick={() => setAmount(a)}>
            ৳{a}
          </button>
        ))}
      </div>
      <label>
        Amount (BDT)
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" required />
      </label>
      <button type="submit" disabled={busy}>{busy ? "Adding…" : "Add balance"}</button>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </form>
  );
}
