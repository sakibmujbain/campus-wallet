"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SavingsConfig({ enabled, step }: { enabled: boolean; step: number }) {
  const router = useRouter();
  const [en, setEn] = useState(enabled);
  const [st, setSt] = useState(String(step));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = en !== enabled || Number(st) !== step;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/savings/config", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: Number(st), enabled: en }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setMsg({ ok: true, text: "Round-up settings saved." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: d.error ?? "Couldn't save." });
      }
    } catch {
      setMsg({ ok: false, text: "Couldn't reach the server — please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "0.5rem", color: "var(--ink)" }}>
        <input type="checkbox" checked={en} onChange={(e) => setEn(e.target.checked)} style={{ width: "auto" }} />
        Round up my purchases and auto-save the change
      </label>
      <label style={{ marginTop: "0.6rem", maxWidth: "16rem" }}>
        Round up to the nearest
        <select value={st} onChange={(e) => setSt(e.target.value)} disabled={!en}>
          <option value="10">৳10</option>
          <option value="50">৳50</option>
        </select>
      </label>
      <button style={{ marginTop: "0.8rem" }} onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save settings"}</button>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} role="status" aria-live="polite">{msg.text}</div>}
    </div>
  );
}
