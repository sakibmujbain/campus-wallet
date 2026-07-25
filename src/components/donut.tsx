// Part-of-whole donut for a drive's payment status (3 states, headcount).
//
// Colour carries state, never identity on its own: every segment is repeated in the
// legend with its label and count, so the chart is readable in greyscale, in print, and
// by a colour-blind reader. The three steps were validated with the dataviz palette
// checker (CVD separation ΔE ≥ 18 in both modes) — see --dv-* in globals.css.
//
// Segments are drawn as dash-array arcs on one circle, each shortened by GAP so a 2px
// ring of the card surface separates neighbours rather than the colours touching.

export interface Slice {
  label: string;
  value: number;
  /** maps to a --dv-* custom property */
  tone: "good" | "info" | "bad";
}

const GAP = 2; // px of surface showing between segments

export function Donut({ slices, size = 132, thickness = 16, centerTop, centerSub }: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  /** big number in the hole — the one figure the chart exists to deliver */
  centerTop: string;
  centerSub?: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const shown = slices.filter((s) => s.value > 0);

  let offset = 0;
  const arcs = shown.map((s) => {
    const frac = total > 0 ? s.value / total : 0;
    const raw = frac * c;
    // only inset a gap when there is more than one visible slice, else a full ring
    const len = shown.length > 1 ? Math.max(raw - GAP, 0.5) : raw;
    const arc = { ...s, len, dash: offset };
    offset += raw;
    return arc;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={`${centerTop} — ${shown.map((s) => `${s.value} ${s.label}`).join(", ")}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness}
        stroke="var(--surface-2)" />
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {arcs.map((a) => (
          <circle key={a.label} cx={size / 2} cy={size / 2} r={r} fill="none"
            strokeWidth={thickness} stroke={`var(--dv-${a.tone})`}
            strokeDasharray={`${a.len} ${c - a.len}`} strokeDashoffset={-a.dash} />
        ))}
      </g>
      <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="donut-value">{centerTop}</text>
      {centerSub && (
        <text x="50%" y="63%" textAnchor="middle" dominantBaseline="middle" className="donut-sub">{centerSub}</text>
      )}
    </svg>
  );
}

/** Legend — the secondary encoding that keeps identity off colour alone. */
export function DonutLegend({ slices }: { slices: Slice[] }) {
  return (
    <ul className="donut-legend">
      {slices.map((s) => (
        <li key={s.label}>
          <span className={`dv-dot dv-${s.tone}`} aria-hidden="true" />
          <span className="dv-label">{s.label}</span>
          <span className="dv-num">{s.value}</span>
        </li>
      ))}
    </ul>
  );
}
