"use client";

import { useEffect } from "react";

// Scoped boundary for the admin console — a failing query on one admin page keeps
// the console recoverable without dropping to the app-wide error page.
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="main-md">
      <div className="eyebrow">Admin</div>
      <h1>Couldn&apos;t load this console</h1>
      <div className="card">
        <div className="msg err">A query failed — the database may be waking up. Try again in a moment.</div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          <button onClick={() => reset()}>Try again</button>
          <a className="btn-ghost" href="/admin">Admin overview</a>
        </div>
      </div>
    </main>
  );
}
