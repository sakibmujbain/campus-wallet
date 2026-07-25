"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DU_DEPARTMENT_GROUPS } from "@/lib/du";

// Dropdown replacement for the long pickers (department / hall / session).
//
// A native <select> renders an OS-drawn popup: the browser sizes it to the longest
// option — DU's departments and halls both run to ~55 characters — so it spills well past
// the field, and with no room below it flips up and covers the page behind it. None of
// that is reachable from CSS. This owns its popup instead: pinned to the trigger's width,
// scrolling inside itself, and filterable once the list is long enough to warrant it.

export interface ComboOption { value: string; label: string }
export interface ComboGroup { label: string; options: ComboOption[] }

/** Lists longer than this get a search box; shorter ones are faster to just eyeball. */
const SEARCH_THRESHOLD = 10;

export function Combo({
  value,
  onChange,
  groups,
  placeholder,
  searchPlaceholder = "Search…",
  allowClear = true,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Grouped options. Use a single group with an empty label for a flat list. */
  groups: ComboGroup[];
  /** Shown when nothing is picked; also the label of the "clear" row. */
  placeholder: string;
  searchPlaceholder?: string;
  /** false for a field that must always hold a value — hides the "clear" row. */
  allowClear?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const total = useMemo(() => groups.reduce((n, g) => n + g.options.length, 0), [groups]);
  const searchable = total > SEARCH_THRESHOLD;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return groups.filter((g) => g.options.length > 0);
    return groups
      .map((g) => ({ label: g.label, options: g.options.filter((o) => o.label.toLowerCase().includes(needle)) }))
      .filter((g) => g.options.length > 0);
  }, [groups, q]);

  const selected = useMemo(
    () => groups.flatMap((g) => g.options).find((o) => o.value === value)?.label ?? "",
    [groups, value],
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setQ(""); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => { if (open && searchable) search.current?.focus(); }, [open, searchable]);

  function pick(v: string) { onChange(v); setOpen(false); setQ(""); }

  return (
    <div className="combo" ref={wrap}>
      <button type="button" id={id} className="combo-trigger" aria-expanded={open} aria-haspopup="true"
        onClick={() => { setOpen((o) => !o); setQ(""); }}>
        <span className={selected ? undefined : "combo-placeholder"}>{selected || placeholder}</span>
        <svg className="combo-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9.5 6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="combo-panel">
          {searchable && (
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder} aria-label={searchPlaceholder} autoComplete="off" />
          )}
          <ul className="combo-list">
            {allowClear && (
              <li>
                <button type="button" className={value === "" ? "is-sel" : undefined} onClick={() => pick("")}>
                  {placeholder}
                </button>
              </li>
            )}
            {shown.map((g, gi) => (
              <li key={g.label || gi} className={g.label ? "combo-group" : undefined}>
                {g.label}
                <ul>
                  {g.options.map((o) => (
                    <li key={o.value}>
                      <button type="button" className={value === o.value ? "is-sel" : undefined} onClick={() => pick(o.value)}>
                        {o.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {shown.length === 0 && <li><span className="typeahead-empty">Nothing matches “{q}”.</span></li>}
          </ul>
        </div>
      )}
    </div>
  );
}

const DEPT_GROUPS: ComboGroup[] = DU_DEPARTMENT_GROUPS.map((g) => ({
  label: g.faculty,
  options: g.departments.map((d) => ({ value: d, label: d })),
}));

/** Department picker — DU's ~85 departments, grouped by faculty. */
export function DeptSelect({ value, onChange, anyLabel = "Any department", id }: {
  value: string; onChange: (v: string) => void; anyLabel?: string; id?: string;
}) {
  return <Combo id={id} value={value} onChange={onChange} groups={DEPT_GROUPS}
    placeholder={anyLabel} searchPlaceholder="Search departments…" />;
}

/** Hall picker — the halls come from the DB, so they are passed in. */
export function HallSelect({ value, onChange, halls, anyLabel = "Any hall", id }: {
  value: string; onChange: (v: string) => void; halls: { hallId: number; name: string }[];
  anyLabel?: string; id?: string;
}) {
  const groups = useMemo<ComboGroup[]>(
    () => [{ label: "", options: halls.map((h) => ({ value: String(h.hallId), label: h.name })) }],
    [halls],
  );
  return <Combo id={id} value={value} onChange={onChange} groups={groups}
    placeholder={anyLabel} searchPlaceholder="Search halls…" />;
}

/** Session picker — short list, so it opens without a search box. */
export function SessionSelect({ value, onChange, sessions, anyLabel = "Any session", allowClear = true, id }: {
  value: string; onChange: (v: string) => void; sessions: readonly string[];
  anyLabel?: string; allowClear?: boolean; id?: string;
}) {
  const groups = useMemo<ComboGroup[]>(
    () => [{ label: "", options: sessions.map((s) => ({ value: s, label: s })) }],
    [sessions],
  );
  return <Combo id={id} value={value} onChange={onChange} groups={groups} placeholder={anyLabel} allowClear={allowClear} />;
}
