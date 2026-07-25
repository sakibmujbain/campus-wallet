"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";

// Fixed light/dark toggle. The initial theme is applied pre-paint by the inline
// script in layout.tsx (no flash); this button flips it and persists to localStorage.
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);

  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* private mode */ }
    setDark(!dark);
  }

  return (
    <button type="button" onClick={toggle} className="theme-toggle"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title="Toggle light / dark">
      <Icon name={dark ? "sun" : "moon"} className="ico-btn" />
    </button>
  );
}
