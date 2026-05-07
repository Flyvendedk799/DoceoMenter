import { getBus, getStore } from "../../../../../lib/server";
import type { RunEvent } from "@doceomenter/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const runId = params.id;
  const store = getStore();
  const state = await store.read(runId);
  if (!state) {
    return new Response("not found", { status: 404 });
  }
  const bus = getBus();
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));

      // Initial snapshot — emit each stage as a stage event so the UI can
      // catch up to current status when reconnecting.
      for (const s of state.stages) send({ type: "stage", stage: s });
      if (state.artifacts) send({ type: "done", artifacts: state.artifacts });
      if (state.error) send({ type: "error", error: state.error });

      const off = bus.subscribe(runId, (e: RunEvent) => send(e));

      const heartbeat = setInterval(() => controller.enqueue(enc.encode(":\n\n")), 15_000);
      _req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        off();
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
