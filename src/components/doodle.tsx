// Hand-drawn brand doodles — one crafted monoline "hand": ~2.4px organic ink stroke,
// rounded caps, a highlighter fill sitting slightly OFF-REGISTER beside the line (the
// wobble + off-register is what defeats the "uniform AI vector" tell). Brand slots only
// (hero backdrop, empty states, loading) — never on data-dense tables.

export function CoinDoodle({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 72 72" fill="none" className={className} style={style} aria-hidden="true">
      {/* off-register highlighter blob */}
      <path d="M33 12 C18 12 9 24 10 38 C11 52 24 61 39 59 C53 57 62 44 60 30 C58 17 47 11 33 12 Z"
        fill="var(--accent)" opacity="0.55" />
      {/* wobbly ink coin outline */}
      <path d="M31 9 C16 10 7 22 8 36 C9 51 22 60 37 58 C51 56 61 43 59 29 C57 15 45 8 31 9 Z"
        stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      {/* inner ring */}
      <path d="M31 17 C20 18 14 27 15 37 C16 48 25 54 35 52 C45 50 51 41 50 31 C49 21 41 16 31 17 Z"
        stroke="var(--ink)" strokeWidth="1.5" fill="none" opacity="0.55" />
      {/* taka-ish mark */}
      <path d="M27 27 h11 M30 27 v15 M25 34.5 h13" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function SparkleDoodle({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} style={style} aria-hidden="true">
      <path d="M24 6 C25 16 30 22 42 24 C30 26 25 32 24 42 C23 32 18 26 6 24 C18 22 23 16 24 6 Z"
        fill="var(--accent)" opacity="0.5" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function DollarDoodle({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 40 62" fill="none" className={className} style={style} aria-hidden="true">
      <path d="M20 5 V57" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M29 18 C29 11 23 8 18 9 C10 10 9 18 14 22 C19 26 27 26 29 33 C31 40 24 45 18 44 C11 43 10 36 11 33"
        stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function ReceiptDoodle({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 48 66" fill="none" className={className} style={style} aria-hidden="true">
      <path d="M8 7 H40 V54 L34 50 L28 54 L22 50 L16 54 L8 50 Z" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M15 18 H33 M15 26 H33 M15 34 H27" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 42 H24" stroke="var(--accent-deep)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** A scattered decorative doodle layer — brand slots only (login, empty states).
 *  Absolutely positioned; place inside a position:relative parent, behind the content. */
export function DoodleScatter() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
      <CoinDoodle style={{ position: "absolute", top: "3%", left: "3%", width: "60px", opacity: 0.5, transform: "rotate(-14deg)" }} />
      <DollarDoodle style={{ position: "absolute", top: "12%", right: "5%", width: "34px", opacity: 0.4, transform: "rotate(12deg)" }} />
      <SparkleDoodle style={{ position: "absolute", top: "38%", left: "1%", width: "30px", opacity: 0.55 }} />
      <ReceiptDoodle style={{ position: "absolute", bottom: "5%", left: "4%", width: "50px", opacity: 0.4, transform: "rotate(-9deg)" }} />
      <CoinDoodle style={{ position: "absolute", bottom: "8%", right: "6%", width: "48px", opacity: 0.45, transform: "rotate(16deg)" }} />
      <DollarDoodle style={{ position: "absolute", bottom: "34%", right: "2%", width: "26px", opacity: 0.32, transform: "rotate(-15deg)" }} />
      <SparkleDoodle style={{ position: "absolute", top: "6%", right: "26%", width: "20px", opacity: 0.4 }} />
    </div>
  );
}
