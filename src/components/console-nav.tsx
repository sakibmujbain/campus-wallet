"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Pill navigation for the admin / organizer consoles, with an active highlight.
export function ConsoleNav({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="console-nav">
      {links.map((l) => (
        <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
