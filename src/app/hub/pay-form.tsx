"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Target {
  accountId: number;
  currency: string;
  instKind: string;
  label: string;
}

export function PayForm({ targets, balance }: { targets: Target[]; balance: string }) {
  const router = useRouter();
  const [to, setTo] = useState<number | "">(targets[0]?.accountId ?? "");
  const [amount, setAmount] = useState("500.00");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Stable idempotency key per payment intent.
  const [idemKey, setIdemKey] = useState("");
  useEffect(() => {
    setIdemKey(crypto.randomUUID());
  }, [to, amount]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // payer is derived from the session server-side — we only send target + amount.
        body: JSON.stringify({ to, amount, idempotencyKey: idemKey || crypto.randomUUID() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMsg({ ok: true, text: `Paid — transaction #${data.txnId}. Spare change swept to savings.` });
        setIdemKey(crypto.randomUUID());
        router.refresh();
      } else {
        setMsg({ ok: false, text: data.error ?? "Payment failed." });
      }
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Pay to
        <select value={to} onChange={(e) => setTo(Number(e.target.value))} required>
          {targets.map((t) => (
            <option key={t.accountId} value={t.accountId}>{t.label}</option>
          ))}
        </select>
      </label>
      <label>
        Amount (BDT) — you have {balance}
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          pattern="^\d+(\.\d{1,4})?$"
          title="A positive amount, up to 4 decimal places"
          required
        />
      </label>
      <button type="submit" disabled={busy || to === ""}>
        {busy ? "Paying…" : "Pay bill"}
      </button>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </form>
  );
}
