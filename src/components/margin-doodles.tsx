"use client";

import { usePathname } from "next/navigation";
import { CoinDoodle, SparkleDoodle, DollarDoodle, ReceiptDoodle } from "./doodle";

/** Static decorative doodles tucked into the empty gutters beside the centred
 *  reading column — recreates the scattered-doodle whitespace of the brand slide.
 *  Purely ornamental (aria-hidden, pointer-events:none); hidden on narrow screens
 *  with no gutter via `.margin-doodles`, and skipped on the full-bleed login page
 *  which carries its own doodle scatter.
 *  Note: the calc(50% - N rem) offsets assume main's 46rem max-width — if that
 *  column ever widens past ~50rem, bump N so the doodles stay clear of content. */
export function MarginDoodles() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <div className="margin-doodles" aria-hidden="true">
      {/* left gutter */}
      <CoinDoodle style={{ top: "13%", left: "calc(50% - 30rem)", width: "66px", opacity: 0.5, transform: "rotate(-12deg)" }} />
      <SparkleDoodle style={{ top: "39%", left: "calc(50% - 27rem)", width: "30px", opacity: 0.5 }} />
      <DollarDoodle style={{ top: "63%", left: "calc(50% - 28.5rem)", width: "30px", opacity: 0.42, transform: "rotate(9deg)" }} />
      <ReceiptDoodle style={{ bottom: "11%", left: "calc(50% - 31rem)", width: "52px", opacity: 0.45, transform: "rotate(-8deg)" }} />
      {/* right gutter */}
      <DollarDoodle style={{ top: "11%", right: "calc(50% - 29rem)", width: "34px", opacity: 0.45, transform: "rotate(13deg)" }} />
      <ReceiptDoodle style={{ top: "31%", right: "calc(50% - 30.5rem)", width: "46px", opacity: 0.4, transform: "rotate(8deg)" }} />
      <SparkleDoodle style={{ top: "54%", right: "calc(50% - 27rem)", width: "24px", opacity: 0.45 }} />
      <CoinDoodle style={{ bottom: "14%", right: "calc(50% - 31rem)", width: "58px", opacity: 0.5, transform: "rotate(15deg)" }} />
    </div>
  );
}
