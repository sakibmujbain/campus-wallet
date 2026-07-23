"use client";

import Link from "next/link";
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
  const [needsTopUp, setNeedsTopUp] = useState(false);

  // Stable idempotency key per payment intent.
  const [idemKey, setIdemKey] = useState("");
  useEffect(() => {
    setIdemKey(crypto.randomUUID());
  }, [to, amount]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setNeedsTopUp(false);
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
        // Translate the ledger's overdraft-floor rejection into a friendly nudge.
        const overdraft = /overdraft floor|not enough|insufficient/i.test(data.error ?? "");
        setNeedsTopUp(overdraft);
        setMsg({ ok: false, text: overdraft ? "Not enough balance to cover this payment." : (data.error ?? "Payment failed.") });
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
      {needsTopUp && (
        <Link href="/top-up" className="btn-primary" style={{ justifySelf: "start" }}>Top up your wallet →</Link>
      )}
    </form>
  );
}
