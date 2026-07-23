import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/viewer";
import { setSavingsConfig } from "@/db/savings";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const Body = z.object({
  step: z.coerce.number().refine((s) => s === 10 || s === 50, "step must be 10 or 50"),
  enabled: z.boolean(),
});

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });

  try {
    await setSavingsConfig(v.appUserId, parsed.data.step, parsed.data.enabled);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
