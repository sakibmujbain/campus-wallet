"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Account {
  accountId: number;
  accountKind: string;
  currency: string;
  balance: string;
}

export function TransferForm({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  // Default to two guaranteed-distinct accounts regardless of how many exist.
  const firstId = accounts[0]?.accountId ?? "";
  const [from, setFrom] = useState<number | "">(firstId);
  const [to, setTo] = useState<number | "">(accounts.find((a) => a.accountId !== firstId)?.accountId ?? "");
  const [amount, setAmount] = useState("100.00");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // A stable idempotency key per transfer *intent*. It is regenerated whenever the
  // intent changes or after a successful post, so a retry of the same intent
  // (network hiccup, resubmit) collapses to ONE ledger transaction.
  const [idemKey, setIdemKey] = useState("");
  useEffect(() => {
    setIdemKey(crypto.randomUUID());
  }, [from, to, amount]);

  const currency = accounts.find((a) => a.accountId === from)?.currency ?? "BDT";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const idempotencyKey = idemKey || crypto.randomUUID();
      const res = await fetch("/api/transfer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to, amount, currency, idempotencyKey }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMsg({ ok: true, text: `Posted transaction #${data.txnId}.` });
        setIdemKey(crypto.randomUUID()); // start a fresh intent
        router.refresh(); // re-derive balances from the ledger
      } else {
        setMsg({ ok: false, text: data.error ?? "Transfer failed." });
      }
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="row">
        <label>
          From
          <select value={from} onChange={(e) => setFrom(Number(e.target.value))} required>
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                #{a.accountId} · {a.accountKind} · {a.currency}
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <select value={to} onChange={(e) => setTo(Number(e.target.value))} required>
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                #{a.accountId} · {a.accountKind} · {a.currency}
              </option>
            ))}
          </select>
        </label>
      </div>
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
        {busy ? "Posting…" : "Post transfer"}
      </button>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </form>
  );
}
