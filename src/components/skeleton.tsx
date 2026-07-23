// Presentational skeletons for route-level loading.tsx boundaries. Pure (no client
// state), so they render on the server while Postgres resolves. Motion is disabled
// under prefers-reduced-motion by the global rule in globals.css.

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

/** N shimmer lines; the last one is shortened to look like text. */
export function SkeletonText({ lines = 3, width = "100%" }: { lines?: number; width?: string }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton skeleton-line" style={{ width: i === lines - 1 ? "60%" : width }} />
      ))}
    </div>
  );
}

export function SkeletonTiles({ n = 3 }: { n?: number }) {
  return (
    <div className="tiles" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => <div key={i} className="skeleton skeleton-tile" />)}
    </div>
  );
}

export function SkeletonCard({ title = true, lines = 3 }: { title?: boolean; lines?: number }) {
  return (
    <div className="card" aria-hidden="true">
      {title && <div className="skeleton skeleton-line" style={{ width: "35%", height: "1rem", marginBottom: "1rem" }} />}
      <SkeletonText lines={lines} />
    </div>
  );
}

/** A card that mimics a data table while it loads. */
export function SkeletonTable({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card" aria-hidden="true">
      <div className="skeleton skeleton-line" style={{ width: "30%", height: "1rem", marginBottom: "1rem" }} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton skeleton-line" style={{ height: "1.1rem", margin: "0.6rem 0" }} />
      ))}
    </div>
  );
}
