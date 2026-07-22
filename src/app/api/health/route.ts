import { NextResponse } from "next/server";
import { pool } from "@/db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight liveness probe. The GitHub Actions keep-alive workflow hits this
// every ~3 days so the free-tier Supabase project never idles into auto-pause.
export async function GET() {
  try {
    const { rows } = await pool.query("SELECT 1 AS ok");
    return NextResponse.json({ ok: rows[0].ok === 1, at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}
