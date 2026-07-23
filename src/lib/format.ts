// Formats an exact NUMERIC string (or number) as BDT, without ever going through a float.
export function money(v: string | number): string {
  const s = typeof v === "number" ? v.toFixed(4) : v;
  const neg = s.startsWith("-");
  const [wholeRaw, frac = ""] = s.replace(/^-/, "").split(".");
  const grouped = wholeRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `৳${neg ? "-" : ""}${grouped}.${(frac + "00").slice(0, 2)}`;
}

/** Short, friendly badge label for an e-KYC status. */
export function kycLabel(status: string): string {
  switch (status) {
    case "verified": return "✓ verified";
    case "pending": return "pending review";
    case "expired": return "⚠ expired";
    case "alumni": return "alumni";
    default: return status;
  }
}

/** Actionable one-liner for a non-verified e-KYC status (null when verified). */
export function kycGuidance(status: string): string | null {
  switch (status) {
    case "pending": return "Your e-KYC is pending review — you can browse, but some actions may be limited until it's verified.";
    case "expired": return "Your e-KYC has expired. Visit the exam office to re-verify your student status.";
    case "alumni": return "Your account is marked alumni. Contact the registrar if this is a mistake.";
    default: return null;
  }
}

// Business-rule SQLSTATEs our functions raise (surface to the user); anything else is internal.
// Includes value-domain violations (numeric overflow 22003, bad datetime 22007/22008) so a
// degenerate but well-formed input is a clean 422, not an opaque 500.
const BUSINESS = new Set(["23514", "23000", "23001", "23505", "P0001", "22003", "22007", "22008"]);
// Transient concurrency failures — safe to retry (our money ops are idempotent by key / short-circuit).
const RETRYABLE = new Set(["40001", "40P01"]);

/** Maps a thrown error to {status, body} — 403 authz, 409 retryable, 422 business, 500 otherwise. */
export function mapPgError(err: unknown): { status: number; body: { ok: false; error: string; code?: string } } {
  const e = err as { message?: string; code?: string };
  if (e.code === "42501") {
    // insufficient_privilege: an ownership/admin/not-authenticated check inside a function
    return { status: 403, body: { ok: false, error: e.message ?? "you are not allowed to do that", code: e.code } };
  }
  if (e.code && RETRYABLE.has(e.code)) {
    return { status: 409, body: { ok: false, error: "the system was busy — please try again", code: e.code } };
  }
  if (e.code && BUSINESS.has(e.code)) {
    return { status: 422, body: { ok: false, error: e.message ?? "request rejected", code: e.code } };
  }
  console.error("internal error:", err);
  return { status: 500, body: { ok: false, error: "something went wrong" } };
}
