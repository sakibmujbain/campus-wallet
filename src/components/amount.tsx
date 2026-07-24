import { money } from "@/lib/format";

// Renders a money value with the ৳ symbol and the .xx cents smaller/muted, so the
// integer taka dominate the hierarchy — the money-typography upgrade for big balances.
export function Amount({ value, className }: { value: string | number; className?: string }) {
  const formatted = money(value); // e.g. "৳1,234.56" or "৳-497.00"
  const m = formatted.match(/^(৳-?)([\d,]+)(\.\d+)?$/);
  if (!m) return <span className={className}>{formatted}</span>;
  const [, cur, whole, cents] = m;
  return (
    <span className={className}>
      <span className="cur">{cur}</span>
      {whole}
      {cents && <span className="cents">{cents}</span>}
    </span>
  );
}
