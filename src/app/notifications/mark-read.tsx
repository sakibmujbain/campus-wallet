"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MarkRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn-ghost" disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/notifications/read", { method: "POST" });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}>
      {busy ? "…" : "Mark all read"}
    </button>
  );
}
