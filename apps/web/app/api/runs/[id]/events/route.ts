import { getBus, getStore, isRedisReachable } from "../../../../../lib/server";
import { isValidRunId, type RunEvent, type TerminalState } from "@doceomenter/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_STATES = new Set<string>(["done", "failed", "partial", "cancelled"]);

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const runId = params.id;
  if (!isValidRunId(runId)) {
    return new Response("not found", { status: 404 });
  }
  const store = getStore();
  const state = await store.read(runId);
  if (!state) {
    return new Response("not found", { status: 404 });
  }
  const bus = getBus(await isRedisReachable());
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));

      let isClosed = false;
      let isDone = false;

      // Initial snapshot — emit each stage as a stage event so the UI can
      // catch up to current status when reconnecting.
      for (const s of state.stages) send({ type: "stage", stage: s });
      if (state.error) send({ type: "error", error: state.error });
      // Always signal terminal state to late/reconnecting subscribers so the UI
      // resolves and the stream can close, even with no artifacts.
      if (TERMINAL_STATES.has(state.state)) {
        isDone = true;
        send({ type: "done", state: state.state as TerminalState, artifacts: state.artifacts ?? {} });
      }

      const off = bus.subscribe(runId, (e: RunEvent) => {
        if (isClosed) return;
        if (e.type === "done") isDone = true;
        send(e);
      });

      const interval = setInterval(async () => {
        if (isClosed) return;
        try {
          if (!isDone) {
            const current = await store.read(runId);
            if (current && TERMINAL_STATES.has(current.state)) {
              isDone = true;
              send({
                type: "done",
                state: current.state as TerminalState,
                artifacts: current.artifacts ?? {},
              });
            }
          }
          controller.enqueue(enc.encode(":\n\n"));
        } catch {}
      }, 2_000);

      _req.signal.addEventListener("abort", () => {
        isClosed = true;
        clearInterval(interval);
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
