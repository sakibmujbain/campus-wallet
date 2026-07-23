"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { money } from "@/lib/format";

interface Due {
  assessmentId: number;
  name: string;
  category: string;
  period: string;
  amount: string;
  status: string;
}

export function DuesList({ dues }: { dues: Due[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (dues.length === 0) return <p style={{ color: "var(--good)" }}>You&apos;re all paid up 🎉</p>;

  async function pay(id: number) {
    setBusy(id);
    setMsg(null);
    try {
      const res = await fetch("/api/dues/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessmentId: id, idempotencyKey: crypto.randomUUID() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMsg({ ok: true, text: `Paid — transaction #${data.txnId}.` });
        router.refresh();
      } else {
        const hint = /overdraft/i.test(data.error ?? "") ? " Top up your wallet and try again." : "";
        setMsg({ ok: false, text: (data.error ?? "Payment failed.") + hint });
      }
    } catch {
      setMsg({ ok: false, text: "Couldn't reach the server — please try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="scroll-x">
        <table>
          <thead>
            <tr><th>Fee</th><th>Period</th><th className="num">Amount</th><th><span className="sr-only">Pay</span></th></tr>
          </thead>
          <tbody>
            {dues.map((d) => (
              <tr key={d.assessmentId}>
                <td>{d.name} <span className="kind">{d.category}</span></td>
                <td><span className="kind">{d.period}</span></td>
                <td className="num">{money(d.amount)}</td>
                <td style={{ textAlign: "right" }}>
                  <button onClick={() => pay(d.assessmentId)} disabled={busy !== null}>
                    {busy === d.assessmentId ? "Paying…" : "Pay"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} role="status" aria-live="polite" style={{ marginTop: "0.75rem" }}>{msg.text}</div>}
    </>
  );
}
