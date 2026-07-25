"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DU_SESSIONS } from "@/lib/du";
import { DeptSelect, HallSelect, SessionSelect } from "@/components/combo";

interface Scope { scopeKind: string; scopeRef: string }
interface HallOption { hallId: number; name: string }

export function NewDriveForm({ scopes, isAdmin, halls }: { scopes: Scope[]; isAdmin: boolean; halls: HallOption[] }) {
  const router = useRouter();
  // The scope only AUTHORISES the drive (organizer_covers checks it). It does not decide
  // who lands on the roster — that is the three independent filters below.
  const scopeList = isAdmin ? [...DU_SESSIONS] : [...new Set(scopes.map((s) => s.scopeRef).filter(Boolean))];
  const [scopeRef, setScopeRef] = useState(scopeList[0] ?? "");

  const [name, setName] = useState("");
  const [pickManually, setPickManually] = useState(false);
  const [department, setDepartment] = useState("");
  const [hallId, setHallId] = useState("");
  const [session, setSession] = useState("");
  const [perHead, setPerHead] = useState("");
  const [deadline, setDeadline] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [match, setMatch] = useState<number | null>(null);

  const hasFilter = Boolean(department || hallId || session);

  // Live "N students match" so the size of the roster is visible before committing —
  // an empty match is otherwise only discovered after the drive exists.
  useEffect(() => {
    if (pickManually || !hasFilter) { setMatch(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams();
        if (department) p.set("department", department);
        if (hallId) p.set("hallId", hallId);
        if (session) p.set("session", session);
        const res = await fetch(`/api/cr/students?${p}`, { signal: ctl.signal });
        const d = await res.json();
        if (d.ok) setMatch(d.count as number);
      } catch { /* aborted or offline */ }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [department, hallId, session, pickManually, hasFilter]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!scopeRef) { setMsg({ ok: false, text: "Pick the scope you're organizing under." }); return; }
    if (!pickManually && !hasFilter) {
      setMsg({ ok: false, text: "Choose at least one of department, hall or session — or start empty and add people yourself." });
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
          scopeRef,
          perHead,
          deadline: deadline || null,
          description: description || null,
          autoRoster: !pickManually,
          department: pickManually ? null : department || null,
          hallId: pickManually || !hallId ? null : Number(hallId),
          session: pickManually ? null : session || null,
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

  if (scopeList.length === 0) {
    return <p style={{ color: "var(--muted)", margin: 0 }}>You don&apos;t have an organizer grant with a batch scope yet. Request one from your <a href="/profile">profile</a>.</p>;
  }

  // Plain-English summary of the filter combination, so "who gets billed" is never a guess.
  const hallName = halls.find((h) => String(h.hallId) === hallId)?.name;
  const parts = [
    department || "All departments",
    hallName ? `living in ${hallName}` : "any hall",
    session ? `session ${session}` : "any session",
  ];

  return (
    <form onSubmit={submit}>
      <label>
        Drive name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="CSE Departmental Tour" required />
      </label>

      <div>
        <span className="field-label">Who&apos;s on the roster?</span>

        <label className={`choice ${!pickManually ? "is-sel" : ""}`}>
          <input type="radio" name="rosterMode" checked={!pickManually} onChange={() => setPickManually(false)} />
          <span>
            <span className="choice-title">Everyone matching these filters</span>
            <span className="choice-desc">Combine any of the three — each one is optional and they work independently.</span>
          </span>
        </label>

        {!pickManually && (
          <div className="roster-filters" style={{ margin: "0.7rem 0 0.5rem" }}>
            <label>
              Department
              <DeptSelect value={department} onChange={setDepartment} />
            </label>
            <label>
              Hall
              <HallSelect value={hallId} onChange={setHallId} halls={halls} />
            </label>
            <label>
              Session
              <SessionSelect value={session} onChange={setSession} sessions={DU_SESSIONS} />
            </label>
          </div>
        )}

        {!pickManually && (
          <p className="filter-summary">
            {hasFilter ? (
              <>
                <strong>{parts[0]}</strong> · {parts[1]} · {parts[2]}
                {match !== null && <span className="filter-count">{match} student{match === 1 ? "" : "s"} match</span>}
              </>
            ) : (
              <span style={{ color: "var(--muted)" }}>Pick a department, a hall, or a session to define the roster.</span>
            )}
          </p>
        )}

        <label className={`choice ${pickManually ? "is-sel" : ""}`} style={{ marginTop: "0.5rem" }}>
          <input type="radio" name="rosterMode" checked={pickManually} onChange={() => setPickManually(true)} />
          <span>
            <span className="choice-title">Start empty — I&apos;ll add people myself</span>
            <span className="choice-desc">Add by department, hall, or name on the next screen.</span>
          </span>
        </label>
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

      {/* Only meaningful when the organizer covers more than one scope (admins cover all). */}
      {scopeList.length > 1 && (
        <label>
          Organizing under
          <SessionSelect value={scopeRef} onChange={setScopeRef} sessions={scopeList} allowClear={false} />
          <span className="kind" style={{ color: "var(--muted)" }}>The scope you were granted — it authorises the drive, it doesn&apos;t filter the roster.</span>
        </label>
      )}

      <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create drive"}</button>
      {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </form>
  );
}
