"use client";

import { useEffect } from "react";

// Registers the service worker so the app is installable as a PWA.
// Kept intentionally minimal for Phase 0; a richer offline strategy comes later.
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return; // avoid caching during dev
    const onLoad = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
