// Shared collection-progress bar with programmatic semantics. Pure/presentational,
// so it works in both server and client components. Replaces the inline bar that was
// copy-pasted across events, the organizer portfolio, and the drive dashboard.

export function Progress({ value, large = false, label }: { value: number; large?: boolean; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={`progress ${large ? "progress-lg" : ""}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Collection progress"}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
