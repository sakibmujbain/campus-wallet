"use client";

import { useEffect } from "react";
import "./globals.css";

// Catches errors in the root layout itself; must render its own <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="main-md">
          <div className="eyebrow">Campus Wallet</div>
          <h1>Something went wrong</h1>
          <div className="card">
            <div className="msg err">The app hit an unexpected error. Please try again.</div>
            <div style={{ marginTop: "1rem" }}>
              <button onClick={() => reset()}>Try again</button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
