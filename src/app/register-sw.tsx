"use client";

import { useEffect } from "react";

// Registers the service worker for PWA/offline. Off by default — the offline shell
// was deferred, and a stale SW causes "my redeploy isn't showing" confusion. Opt in
// later by setting NEXT_PUBLIC_ENABLE_SW=true (no code change needed).
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return; // never cache during dev
    if (process.env.NEXT_PUBLIC_ENABLE_SW !== "true") return; // opt-in only
    const onLoad = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
