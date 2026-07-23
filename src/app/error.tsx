"use client";

import { useEffect } from "react";

// Route-level error boundary: any thrown server/client error in a page renders this
// instead of a raw crash overlay. `reset()` re-renders the segment (re-runs the query).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="main-md">
      <div className="eyebrow">Campus Wallet</div>
      <h1>Something went wrong</h1>
      <div className="card">
        <div className="msg err">
          We couldn&apos;t load this page — the server may be waking up. Please try again in a moment.
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          <button onClick={() => reset()}>Try again</button>
          <a className="btn-ghost" href="/">Go to dashboard</a>
        </div>
      </div>
    </main>
  );
}
