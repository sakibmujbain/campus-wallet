import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/viewer";
import { decideRoleRequest } from "@/db/admin";
import { mapPgError } from "@/lib/format";

export const runtime = "nodejs";

const Body = z.object({
  requestId: z.coerce.number().int().positive(),
  approve: z.boolean(),
});

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  if (!v.isAdmin) return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid input" }, { status: 400 });

  try {
    await decideRoleRequest(v.appUserId, parsed.data.requestId, parsed.data.approve);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const m = mapPgError(err);
    return NextResponse.json(m.body, { status: m.status });
  }
}
