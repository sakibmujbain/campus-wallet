"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DU_SESSIONS } from "@/lib/du";
import { DeptSelect, HallSelect, SessionSelect } from "@/components/combo";

interface Scope { scopeKind: string; scopeRef: string }
interface HallOption { hallId: number; name: string }
/** "filtered" narrows the session by department and/or hall — the same combination the
 *  drive console's "add all matching" supports, so both paths mean the same thing. */
type RosterMode = "everyone" | "filtered" | "pick";

export function NewDriveForm({ scopes, isAdmin, halls }: { scopes: Scope[]; isAdmin: boolean; halls: HallOption[] }) {
  const router = useRouter();
  // Sessions this organizer may run a drive for: admins cover every session; everyone
  // else is limited to the batch scopes they were granted.
  const sessionList = isAdmin
    ? [...DU_SESSIONS]
    : [...new Set(scopes.map((s) => s.scopeRef).filter(Boolean))];

  const [name, setName] = useState("");
  const [session, setSession] = useState(sessionList[0] ?? "");
  const [rosterMode, setRosterMode] = useState<RosterMode>("everyone");
  const [department, setDepartment] = useState("");
  const [hallId, setHallId] = useState("");
  const [perHead, setPerHead] = useState("");
  const [deadline, setDeadline] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) { setMsg({ ok: false, text: "Pick a session." }); return; }
    if (rosterMode === "filtered" && !department && !hallId) {
      setMsg({ ok: false, text: "Choose a department or a hall — or switch to “Everyone in this session”." });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/cr/drives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          scopeKind: "batch",
          scopeRef: session,
          perHead,
          deadline: deadline || null,
          description: description || null,
          autoRoster: rosterMode !== "pick",
          department: rosterMode === "filtered" && department ? department : null,
          hallId: rosterMode === "filtered" && hallId ? Number(hallId) : null,
        }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        router.push(`/cr/drives/${d.eventId}`);
        router.refresh();
      } else {
        setMsg({ ok: false, text: d.error ?? "Could not create the drive." });
        setBusy(false);
      }
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
      setBusy(false);
    }
  }

  if (sessionList.length === 0) {
    return <p style={{ color: "var(--muted)", margin: 0 }}>You don&apos;t have an organizer grant with a batch scope yet. Request one from your <a href="/profile">profile</a>.</p>;
  }

  const choices: { mode: RosterMode; title: string; desc: string }[] = [
    { mode: "everyone", title: `Everyone in session ${session}`, desc: "every student in this session is rostered at the amount below" },
    { mode: "filtered", title: "Only a department or hall", desc: "narrow this session by department, by hall, or both together" },
    { mode: "pick", title: "Let me add people myself", desc: "start empty, then add by department, hall, or name on the next screen" },
  ];

  return (
    <form onSubmit={submit}>
      <label>
        Drive name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="CSE Batch Picnic" required />
      </label>

      <label>
        Session
        <SessionSelect value={session} onChange={setSession} sessions={sessionList} allowClear={false} />
      </label>

      <div>
        <span className="field-label">Who&apos;s on the roster?</span>
        <div className="choice-group">
          {choices.map((c) => (
            <label key={c.mode} className={`choice ${rosterMode === c.mode ? "is-sel" : ""}`}>
              <input type="radio" name="rosterMode" checked={rosterMode === c.mode} onChange={() => setRosterMode(c.mode)} />
              <span>
                <span className="choice-title">{c.title}</span>
                <span className="choice-desc">{c.desc}</span>
              </span>
            </label>
          ))}
        </div>
        {rosterMode === "filtered" && (
          <div className="row" style={{ marginTop: "0.6rem" }}>
            <label>
              Department
              <DeptSelect value={department} onChange={setDepartment} />
            </label>
            <label>
              Hall
              <HallSelect value={hallId} onChange={setHallId} halls={halls} />
            </label>
          </div>
        )}
      </div>

      <div className="row">
        <label>
          Amount per person (৳)
          <input value={perHead} onChange={(e) => setPerHead(e.target.value)} inputMode="decimal" placeholder="500" required />
        </label>
        <label>
          Deadline (optional)
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
      </div>

      <label>
        Description (optional)
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000}
          placeholder="Annual picnic at Cox's Bazar — itinerary, what's included, etc." />
        <span className="kind" style={{ justifySelf: "end", color: description.length > 1900 ? "var(--bad)" : "var(--muted)" }}>
          {description.length}/2000
        </span>
      </label>

      <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create drive"}</button>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </form>
  );
}
