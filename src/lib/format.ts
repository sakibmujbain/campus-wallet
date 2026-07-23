// Formats an exact NUMERIC string (or number) as BDT, without ever going through a float.
export function money(v: string | number): string {
  const s = typeof v === "number" ? v.toFixed(4) : v;
  const neg = s.startsWith("-");
  const [wholeRaw, frac = ""] = s.replace(/^-/, "").split(".");
  const grouped = wholeRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `৳${neg ? "-" : ""}${grouped}.${(frac + "00").slice(0, 2)}`;
}

// Business-rule SQLSTATEs our functions raise (surface to the user); anything else is internal.
const BUSINESS = new Set(["23514", "23000", "23001", "23505", "42501", "P0001"]);

/** Maps a thrown error to {status, body} — 422 for business rules, 500 (generic) otherwise. */
export function mapPgError(err: unknown): { status: number; body: { ok: false; error: string; code?: string } } {
  const e = err as { message?: string; code?: string };
  if (e.code && BUSINESS.has(e.code)) {
    return { status: 422, body: { ok: false, error: e.message ?? "request rejected", code: e.code } };
  }
  console.error("internal error:", err);
  return { status: 500, body: { ok: false, error: "something went wrong" } };
}
