"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DU_DEPARTMENT_GROUPS } from "@/lib/du";

// Searchable department picker.
//
// A native <select> holding DU's ~85 department names renders an OS-drawn popup: the
// browser sizes it to the longest label ("Applied Physics, Electronics and Communication
// Engineering"), so it spills far past the field, and near the page bottom it flips up and
// covers the content behind it. None of that is reachable from CSS. This owns its popup —
// it matches the trigger's width, scrolls inside itself, and filters as you type, which
// also beats scrolling 85 rows to find one department.
export function DeptSelect({
  value,
  onChange,
  anyLabel = "Any department",
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Shown when nothing is picked; also the label of the "clear" row. */
  anyLabel?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return DU_DEPARTMENT_GROUPS.map((g) => ({
      faculty: g.faculty,
      departments: needle ? g.departments.filter((d) => d.toLowerCase().includes(needle)) : [...g.departments],
    })).filter((g) => g.departments.length > 0);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setQ(""); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => { if (open) search.current?.focus(); }, [open]);

  function pick(v: string) { onChange(v); setOpen(false); setQ(""); }

  return (
    <div className="combo" ref={wrap}>
      <button type="button" id={id} className="combo-trigger" aria-expanded={open} aria-haspopup="true"
        onClick={() => { setOpen((o) => !o); setQ(""); }}>
        <span className={value ? undefined : "combo-placeholder"}>{value || anyLabel}</span>
        <svg className="combo-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9.5 6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="combo-panel">
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search departments…" aria-label="Search departments" autoComplete="off" />
          <ul className="combo-list">
            <li><button type="button" className={value === "" ? "is-sel" : undefined} onClick={() => pick("")}>{anyLabel}</button></li>
            {groups.map((g) => (
              <li key={g.faculty} className="combo-group">
                {g.faculty}
                <ul>
                  {g.departments.map((d) => (
                    <li key={d}>
                      <button type="button" className={value === d ? "is-sel" : undefined} onClick={() => pick(d)}>{d}</button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {groups.length === 0 && <li><span className="typeahead-empty">No department matches “{q}”.</span></li>}
          </ul>
        </div>
      )}
    </div>
  );
}
