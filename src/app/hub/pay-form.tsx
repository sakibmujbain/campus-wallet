"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Wallet {
  accountId: number;
  studentName: string;
  studentNo: string;
  balance: string;
}
interface Target {
  accountId: number;
  currency: string;
  instKind: string;
  label: string;
}

export function PayForm({ wallets, targets }: { wallets: Wallet[]; targets: Target[] }) {
  const router = useRouter();
  const [from, setFrom] = useState<number | "">(wallets[0]?.accountId ?? "");
  const [to, setTo] = useState<number | "">(targets[0]?.accountId ?? "");
  const [amount, setAmount] = useState("500.00");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Stable idempotency key per payment intent (regenerated on change / success).
  const [idemKey, setIdemKey] = useState("");
  useEffect(() => {
    setIdemKey(crypto.randomUUID());
  }, [from, to, amount]);

  const currency = targets.find((t) => t.accountId === to)?.currency ?? "BDT";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/transfer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to, amount, currency, kind: "purchase", idempotencyKey: idemKey || crypto.randomUUID() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMsg({ ok: true, text: `Paid — transaction #${data.txnId}.` });
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
        Pay from
        <select value={from} onChange={(e) => setFrom(Number(e.target.value))} required>
          {wallets.map((w) => (
            <option key={w.accountId} value={w.accountId}>
              {w.studentName} ({w.studentNo}) — {Number(w.balance).toFixed(2)} BDT
            </option>
          ))}
        </select>
      </label>
      <label>
        Pay to
        <select value={to} onChange={(e) => setTo(Number(e.target.value))} required>
          {targets.map((t) => (
            <option key={t.accountId} value={t.accountId}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Amount ({currency})
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          pattern="^\d+(\.\d{1,4})?$"
          title="A positive amount, up to 4 decimal places"
          required
        />
      </label>
      <button type="submit" disabled={busy || from === "" || to === ""}>
        {busy ? "Paying…" : "Pay bill"}
      </button>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </form>
  );
}
