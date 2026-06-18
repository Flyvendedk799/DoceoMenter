import { NextResponse } from "next/server";
import { stat, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { isValidRunId } from "@doceomenter/shared";
import { getStore } from "../../../../../../lib/server";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string; path: string[] } },
) {
  if (!isValidRunId(params.id)) {
    return new NextResponse("not found", { status: 404 });
  }
  const store = getStore();
  const root = resolve(store.runDir(params.id));

  let rel: string;
  try {
    rel = (params.path ?? []).map((p) => decodeURIComponent(p)).join("/");
  } catch {
    // Malformed percent-encoding.
    return new NextResponse("bad request", { status: 400 });
  }

  const target = resolve(root, rel);
  // Confine to the run directory: equal to root, or strictly beneath it.
  if (target !== root && !target.startsWith(root + sep)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  try {
    const s = await stat(target);
    if (!s.isFile()) return new NextResponse("not found", { status: 404 });
    // Re-check after symlink resolution so a symlink inside the run dir can't
    // point outside it.
    const realTarget = await realpath(target);
    const realRoot = await realpath(root);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      return new NextResponse("forbidden", { status: 403 });
    }
    const mime = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
    const stream = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "content-type": mime,
        "content-length": String(s.size),
        "cache-control": "private, max-age=60",
        // Don't let the browser sniff octet-streams into executable types.
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
