"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CoinDoodle } from "@/components/doodle";
import { ThemeToggle } from "@/components/theme-toggle";

// Global top bar on every page: the Campus Wallet logo (→ home) on the left,
// a Back button (previous page) when you're not already home, and the theme toggle.
export function AppBar() {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === "/login") return null; // login is its own full-bleed brand page

  const onHome = pathname === "/";
  return (
    <header className="appbar">
      <div className="appbar-left">
        <Link href="/" className="appbar-logo" aria-label="Campus Wallet — home">
          <CoinDoodle style={{ width: "1.7rem", height: "1.7rem" }} />
          <span className="appbar-word">Campus Wallet</span>
        </Link>
        {!onHome && (
          <button type="button" className="appbar-back" onClick={() => router.back()} aria-label="Go back to the previous page">
            <span aria-hidden="true">←</span> Back
          </button>
        )}
      </div>
      <ThemeToggle />
    </header>
  );
}
