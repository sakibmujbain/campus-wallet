"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DU_SESSIONS } from "@/lib/du";
import { DeptSelect, HallSelect, SessionSelect } from "@/components/combo";

interface HallOption { hallId: number; name: string }
interface Current { department: string | null; hallId: number | null; hallName: string | null; session: string | null }

export function AcademicInfo({ halls, current }: { halls: HallOption[]; current: Current }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [department, setDepartment] = useState(current.department ?? "");
  const [hallId, setHallId] = useState(current.hallId ? String(current.hallId) : "");
  const [session, setSession] = useState(current.session ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile/academics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ department, hallId: Number(hallId), session }),
      });
      const d = await res.json();
      if (res.ok && d.ok) { setEditing(false); router.refresh(); }
      else setMsg({ ok: false, text: d.error ?? "Couldn't save." });
    } catch {
      setMsg({ ok: false, text: "Couldn't reach the server — please try again." });
    } finally {
      setBusy(false);
    }
  }

  const notSet = <span style={{ color: "var(--muted)" }}>Not set</span>;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Academic info</h2>
        {!editing && <button className="btn-ghost" onClick={() => setEditing(true)}>Edit</button>}
      </div>

      {!editing ? (
        <div style={{ marginTop: "0.85rem", display: "grid", gap: "0.5rem", fontSize: "0.92rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
            <span style={{ color: "var(--muted)" }}>Department</span><span>{current.department ?? notSet}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
            <span style={{ color: "var(--muted)" }}>Hall</span><span>{current.hallName ?? notSet}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
            <span style={{ color: "var(--muted)" }}>Session</span><span>{current.session ?? notSet}</span>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: "0.85rem", display: "grid", gap: "0.85rem" }}>
          <label>
            Department
            <DeptSelect value={department} onChange={setDepartment} anyLabel="Select department…" />
          </label>
          <div className="row">
            <label>
              Hall
              <HallSelect value={hallId} onChange={setHallId} halls={halls} anyLabel="Select hall…" />
            </label>
            <label>
              Session
              <SessionSelect value={session} onChange={setSession} sessions={DU_SESSIONS} anyLabel="Select session…" />
            </label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button disabled={busy || !department || !hallId || !session} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button className="btn-ghost" disabled={busy} onClick={() => { setEditing(false); setMsg(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`} style={{ marginTop: "0.6rem" }}>{msg.text}</div>}
    </div>
  );
}
