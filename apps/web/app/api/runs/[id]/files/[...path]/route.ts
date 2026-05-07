import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
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
  const store = getStore();
  const root = resolve(store.runDir(params.id));
  const rel = (params.path ?? []).map((p) => decodeURIComponent(p)).join("/");
  const target = normalize(join(root, rel));
  if (!target.startsWith(root)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  try {
    const s = await stat(target);
    if (!s.isFile()) return new NextResponse("not found", { status: 404 });
    const mime = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
    const stream = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "content-type": mime,
        "content-length": String(s.size),
        "cache-control": "private, max-age=60",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
