"use client";

import { usePathname } from "next/navigation";
import { CoinDoodle, SparkleDoodle, DollarDoodle, ReceiptDoodle } from "./doodle";

/** Static decorative doodles tucked into the empty gutters beside the centred
 *  reading column — recreates the scattered-doodle whitespace of the brand slide.
 *  Purely ornamental (aria-hidden, pointer-events:none); hidden on narrow screens
 *  with no gutter via `.margin-doodles`, and skipped on the full-bleed login page
 *  which carries its own doodle scatter.
 *  The calc(50% - N rem) offsets are keyed to main's max-width: the dashboard runs
 *  a wide 74rem column (half-width 37rem), so there we push each doodle a further
 *  `g` rem outward and (via `.margin-doodles.wide` in CSS) only reveal them once the
 *  viewport is wide enough to leave a real gutter beside that column. */
export function MarginDoodles() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  // Offsets are keyed to the page's content column (default 46rem, half-width 23rem).
  // Wider columns push each doodle a further `g` rem outward and get a CSS class that
  // reveals them only once the viewport is wide enough to leave a gutter (g ≈ half − 23).
  let g = 0;
  let tier = "";
  // dashboard and the admin console both run a wide 74rem column
  if (pathname === "/" || pathname.startsWith("/admin")) { g = 13; tier = " col-74"; }

  return (
    <div className={`margin-doodles${tier}`} aria-hidden="true">
      {/* left gutter */}
      <CoinDoodle style={{ top: "13%", left: `calc(50% - ${30 + g}rem)`, width: "66px", opacity: 0.5, transform: "rotate(-12deg)" }} />
      <SparkleDoodle style={{ top: "39%", left: `calc(50% - ${27 + g}rem)`, width: "30px", opacity: 0.5 }} />
      <DollarDoodle style={{ top: "63%", left: `calc(50% - ${28.5 + g}rem)`, width: "30px", opacity: 0.42, transform: "rotate(9deg)" }} />
      <ReceiptDoodle style={{ bottom: "11%", left: `calc(50% - ${31 + g}rem)`, width: "52px", opacity: 0.45, transform: "rotate(-8deg)" }} />
      {/* right gutter */}
      <DollarDoodle style={{ top: "11%", right: `calc(50% - ${29 + g}rem)`, width: "34px", opacity: 0.45, transform: "rotate(13deg)" }} />
      <ReceiptDoodle style={{ top: "31%", right: `calc(50% - ${30.5 + g}rem)`, width: "46px", opacity: 0.4, transform: "rotate(8deg)" }} />
      <SparkleDoodle style={{ top: "54%", right: `calc(50% - ${27 + g}rem)`, width: "24px", opacity: 0.45 }} />
      <CoinDoodle style={{ bottom: "14%", right: `calc(50% - ${31 + g}rem)`, width: "58px", opacity: 0.5, transform: "rotate(15deg)" }} />
    </div>
  );
}
