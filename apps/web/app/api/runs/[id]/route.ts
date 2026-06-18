import { NextResponse } from "next/server";
import { isValidRunId } from "@doceomenter/shared";
import { getStore } from "../../../../lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isValidRunId(params.id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const state = await getStore().read(params.id);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state);
}
