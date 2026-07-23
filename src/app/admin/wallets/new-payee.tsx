"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Hall { hallId: number; name: string }

export function NewPayee({ halls }: { halls: Hall[] }) {
  const router = useRouter();
  const [kind, setKind] = useState("exam");
  const [ref, setRef] = useState("");
  const [ref2, setRef2] = useState("");
  const [hallId, setHallId] = useState(String(halls[0]?.hallId ?? ""));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const refValue = kind === "hall" ? hallId : ref.trim();
    if (!refValue) { setMsg({ ok: false, text: kind === "hall" ? "Pick a hall." : "Enter a reference." }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/wallets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, ref: refValue, ref2: kind === "cafeteria" ? ref2 || null : null }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setMsg({ ok: true, text: `Created payee #${d.accountId}.` });
        setRef(""); setRef2("");
        router.refresh();
      } else {
        setMsg({ ok: false, text: d.error ?? "Could not create the payee." });
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
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="exam">Exam controller</option>
            <option value="hall">Hall administration</option>
            <option value="cafeteria">Cafeteria till</option>
          </select>
        </label>
        {kind === "hall" ? (
          <label>
            Hall
            <select value={hallId} onChange={(e) => setHallId(e.target.value)}>
              {halls.length === 0 && <option value="">(no halls seeded)</option>}
              {halls.map((h) => <option key={h.hallId} value={h.hallId}>{h.name}</option>)}
            </select>
          </label>
        ) : (
          <label>
            {kind === "exam" ? "Department" : "Till location"}
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={kind === "exam" ? "CSE" : "North Cafeteria"} />
          </label>
        )}
      </div>
      {kind === "cafeteria" && (
        <label>
          IoT device id (optional)
          <input value={ref2} onChange={(e) => setRef2(e.target.value)} placeholder="IOT-CAF-02" />
        </label>
      )}
      <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create payee"}</button>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} role="status" aria-live="polite">{msg.text}</div>}
    </form>
  );
}
