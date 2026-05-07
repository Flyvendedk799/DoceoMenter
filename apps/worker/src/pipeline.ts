import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { boot, detectStrategy } from "@doceomenter/boot";
import { postProcessAssets, runCapturePlan } from "@doceomenter/capture";
import { createClaudeClient } from "@doceomenter/claude";
import { renderDeck, renderMarkdown, renderPdfFromDeck } from "@doceomenter/render";
import {
  resolveRunSpec,
  type Analysis,
  type CaptureManifest,
  type GeneratedContent,
  type RunSpec,
  type RunState,
  type StageState,
} from "@doceomenter/shared";
import { cloneRepo } from "./stages/01-clone.js";
import { analyzeRepo } from "./stages/02-analyze.js";
import type { WorkerConfig } from "./config.js";
import type { RunStore } from "./runStore.js";
import type { RunEventBus } from "./eventBus.js";

export async function runPipeline(opts: {
  runId: string;
  spec: RunSpec;
  config: WorkerConfig;
  store: RunStore;
  bus: RunEventBus;
}): Promise<RunState> {
  const { runId, spec, config, store, bus } = opts;
  const resolved = resolveRunSpec(spec);
  const dir = await store.ensure(runId);
  let state = (await store.read(runId)) ?? buildInitialState(runId, spec);
  state.state = "running";
  state.updatedAt = new Date().toISOString();
  await store.write(runId, state);
  await bus.log(runId, `pipeline start runId=${runId} url=${resolved.url}`);

  const setStage = async (
    name: StageState["name"],
    patch: Partial<StageState> & { status: StageState["status"] },
  ) => {
    const stage = state.stages.find((s) => s.name === name)!;
    Object.assign(stage, patch);
    if (patch.status === "running") stage.startedAt = new Date().toISOString();
    if (
      patch.status === "done" ||
      patch.status === "failed" ||
      patch.status === "skipped" ||
      patch.status === "degraded"
    ) {
      stage.finishedAt = new Date().toISOString();
    }
    state.updatedAt = new Date().toISOString();
    await store.write(runId, state);
    await bus.stage(runId, stage);
  };

  let degraded = false;
  let analysis: Analysis | undefined;
  let bootedKill: (() => Promise<void>) | undefined;

  try {
    // 1. Clone
    await setStage("clone", { status: "running", message: "git clone" });
    const repoDir = join(dir, "repo");
    const { owner, name } = parseRepoUrl(resolved.url);
    const { commitSha, sizeBytes } = await cloneRepo({
      url: resolved.url,
      ref: resolved.ref,
      destDir: repoDir,
      maxRepoMb: config.MAX_REPO_MB,
      log: (l) => void bus.log(runId, l),
    });
    await setStage("clone", { status: "done", message: `cloned ${sizeBytes} bytes` });

    // 2. Analyze
    await setStage("analyze", { status: "running", message: "static analysis" });
    analysis = await analyzeRepo({
      repoDir,
      repoOwner: owner,
      repoName: name,
      ref: resolved.ref,
      commitSha,
      sizeBytes,
      log: (l) => void bus.log(runId, l),
    });
    await writeFile(join(dir, "analysis.json"), JSON.stringify(analysis, null, 2));
    await setStage("analyze", {
      status: "done",
      message: `${analysis.fileCount} files, ${Object.keys(analysis.languages).length} langs`,
    });

    // 3. Claude — concept + plan
    await setStage("draft-concept", { status: "running", message: "Claude concept + plan" });
    const claude = createClaudeClient({
      apiKey: spec.apiKey ?? config.ANTHROPIC_API_KEY,
      logger: (l) => void bus.log(runId, l),
    });
    const { concept, capturePlan } = await claude.draftConceptAndPlan(analysis, {
      includeVideo: resolved.includeVideo,
      outputStyle: resolved.outputStyle,
    });
    await writeFile(join(dir, "plan.json"), JSON.stringify({ concept, capturePlan }, null, 2));
    await setStage("draft-concept", { status: "done", message: `${capturePlan.shots.length} shots planned` });

    // 4. Detect runtime
    await setStage("detect-runtime", { status: "running", message: "project type" });
    const strategy = detectStrategy(analysis, config.ENABLE_DOCKER_IN_DOCKER);
    await bus.log(runId, `[detect] strategy=${strategy.kind}`);
    await setStage("detect-runtime", { status: "done", message: strategy.kind });

    // 5. Boot (skipped for cli/library/unknown OR when bootApp=false)
    let liveAppUrl: string | undefined;
    if (
      !resolved.bootApp ||
      strategy.kind === "cli" ||
      strategy.kind === "library" ||
      strategy.kind === "unknown"
    ) {
      await setStage("boot", { status: "skipped", message: `strategy=${strategy.kind}` });
    } else {
      await setStage("boot", { status: "running", message: `booting ${strategy.kind}` });
      try {
        const booted = await boot({
          strategy,
          repoDir,
          log: (l) => void bus.log(runId, l),
        });
        liveAppUrl = booted.url;
        bootedKill = booted.kill;
        await setStage("boot", { status: "done", message: liveAppUrl });
      } catch (e) {
        degraded = true;
        await setStage("boot", { status: "degraded", message: (e as Error).message });
      }
    }

    // 6. Capture
    await setStage("capture", { status: "running", message: `${capturePlan.shots.length} shots` });
    const captureManifest: CaptureManifest = await runCapturePlan(capturePlan, {
      ...(liveAppUrl ? { liveAppUrl } : {}),
      ownerRepo: `${owner}/${name}`,
      outDir: join(dir, "assets"),
      log: (l) => void bus.log(runId, l),
    });
    const okCount = captureManifest.entries.filter((e) => e.status === "ok").length;
    if (okCount === 0) {
      degraded = true;
      await setStage("capture", { status: "degraded", message: "no shots succeeded" });
    } else if (okCount < captureManifest.entries.length) {
      await setStage("capture", { status: "degraded", message: `${okCount}/${captureManifest.entries.length} ok` });
    } else {
      await setStage("capture", { status: "done", message: `${okCount}/${captureManifest.entries.length} ok` });
    }

    // Tear down booted app early — captures done.
    if (bootedKill) {
      await bootedKill().catch(() => {});
      bootedKill = undefined;
    }

    // 7. Claude — technical + captions + summary
    await setStage("draft-technical", { status: "running", message: "Claude technical pass" });
    const { technical, captions, summary } = await claude.draftTechnicalAndCaptions(
      analysis,
      concept,
      capturePlan,
      captureManifest,
    );
    await setStage("draft-technical", { status: "done", message: `${captions.length} captions` });

    const generated: GeneratedContent = {
      concept,
      capturePlan,
      technical,
      captions,
      summary,
    };
    await writeFile(join(dir, "content.json"), JSON.stringify(generated, null, 2));

    // 8. Post-process assets
    await setStage("post-process", { status: "running", message: "WebP + thumbnails" });
    await postProcessAssets(captureManifest, join(dir, "assets"));
    await setStage("post-process", { status: "done", message: "done" });

    // 9. Render
    await setStage("render", { status: "running", message: "markdown + deck + pdf" });
    const reportMdPath = join(dir, "report.md");
    const deckHtmlPath = join(dir, "deck.html");
    const deckPdfPath = join(dir, "deck.pdf");
    const renderInput = {
      runId,
      generatedAt: new Date().toISOString(),
      analysis,
      content: generated,
      capture: captureManifest,
      assetsBasePath: "./assets",
    };
    await renderMarkdown(renderInput, reportMdPath);
    await renderDeck(renderInput, deckHtmlPath);
    try {
      await renderPdfFromDeck(deckHtmlPath, deckPdfPath);
    } catch (e) {
      degraded = true;
      await bus.log(runId, `[render] PDF failed: ${(e as Error).message}`, "warn");
    }
    state.artifacts = {
      reportMd: "report.md",
      deckHtml: "deck.html",
      deckPdf: "deck.pdf",
    };
    await setStage("render", { status: "done", message: "rendered" });

    // Done
    state.state = degraded ? "partial" : "done";
    state.updatedAt = new Date().toISOString();
    await store.write(runId, state);
    await bus.publish(runId, { type: "done", artifacts: state.artifacts });
    return state;
  } catch (err) {
    const msg = (err as Error).message;
    state.state = "failed";
    state.error = msg;
    state.updatedAt = new Date().toISOString();
    await store.write(runId, state);
    await bus.log(runId, `pipeline failed: ${msg}`, "error");
    await bus.publish(runId, { type: "error", error: msg });
    throw err;
  } finally {
    if (bootedKill) await bootedKill().catch(() => {});
  }
}

function buildInitialState(runId: string, spec: RunSpec): RunState {
  const stages: StageState[] = (
    [
      "clone",
      "analyze",
      "draft-concept",
      "detect-runtime",
      "boot",
      "capture",
      "draft-technical",
      "post-process",
      "render",
    ] as const
  ).map((name) => ({ name, status: "pending" }));
  const now = new Date().toISOString();
  return {
    runId,
    spec,
    state: "queued",
    createdAt: now,
    updatedAt: now,
    stages,
  };
}

function parseRepoUrl(url: string): { owner: string; name: string } {
  const gh = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (gh) return { owner: gh[1] ?? "", name: gh[2] ?? "" };
  // file:// or local path: derive a synthetic owner/name from the basename.
  const file = url.match(/^(?:file:\/\/)?(.+)$/);
  if (file) {
    const segments = (file[1] ?? "").replace(/\/$/, "").split("/");
    const last = segments[segments.length - 1] ?? "repo";
    const second = segments[segments.length - 2] ?? "local";
    return { owner: second.replace(/[^a-zA-Z0-9_-]/g, "_"), name: last.replace(/\.git$/, "") };
  }
  throw new Error(`invalid repo URL: ${url}`);
}
