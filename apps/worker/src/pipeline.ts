import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { boot, detectStrategy } from "@doceomenter/boot";
import { postProcessAssets, runCapturePlan } from "@doceomenter/capture";
import { createClaudeClient } from "@doceomenter/claude";
import {
  CredentialError,
  describeProvider,
  modelSpec,
  resolveProviderCredential,
  type ProviderCredential,
} from "@doceomenter/auth";
import {
  renderCaseStudyExport,
  renderDeck,
  renderMarkdown,
  renderPdfFromDeck,
  renderQualityReport,
} from "@doceomenter/render";
import {
  STAGE_NAMES,
  resolveRunSpec,
  redactSpec,
  type Analysis,
  type CaptureManifest,
  type GeneratedContent,
  type ResolvedRunSpec,
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
  /**
   * Whose credential to spend, from the signed cookie on the request that started the run.
   *
   * The id travels rather than the token. A subscription's access token is refreshed on the
   * way out of the account store, so one handed over at enqueue time could easily be stale by
   * the time a queued job reaches a worker — and a token in a job payload is a token sitting
   * in Redis.
   */
  accountId?: string | null;
}): Promise<RunState> {
  const { runId, spec, config, store, bus } = opts;
  const resolved = resolveRunSpec(spec);
  // Wall-clock guard: aborts the run when MAX_RUN_SECONDS is exceeded so a
  // pathological repo can never pin the single-concurrency worker indefinitely.
  const ac = new AbortController();
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
    // Once the deadline has fired, stop mutating/persisting state so the
    // timeout failure recorded by the catch handler is not overwritten.
    if (ac.signal.aborted) return;
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

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      ac.abort();
      // Tear down a booted app if the run is killed after it came up.
      if (bootedKill) void bootedKill().catch(() => {});
      reject(new Error(`run exceeded MAX_RUN_SECONDS=${config.MAX_RUN_SECONDS}s`));
    }, config.MAX_RUN_SECONDS * 1000);
  });

  try {
    const work = (async (): Promise<RunState> => {
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
      signal: ac.signal,
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

    // 3. AI provider — concept + plan
    const descriptor = describeProvider(resolved.provider);
    const credential = await resolveCredential({
      provider: resolved.provider,
      accountId: opts.accountId ?? null,
      inlineKey: spec.apiKey,
      log: (l, level) => void bus.log(runId, l, level),
    });
    const wire = descriptor.wire;
    const configuredModel =
      wire === "openai" ? config.OPENAI_MODEL_PRIMARY : config.ANTHROPIC_MODEL_PRIMARY;
    // A requested model the registry does not know is still honoured — the catalogue is a
    // convenience, not an allowlist, and a model that shipped this morning is not an error.
    // One it *does* know, on the wrong wire, is: sending `gpt-5` to Anthropic can only 404.
    const requestedWire = resolved.model ? modelSpec(resolved.model)?.wire : undefined;
    const modelUsable = resolved.model !== undefined && requestedWire !== (wire === "openai" ? "anthropic" : "openai");
    if (resolved.model && !modelUsable) {
      await bus.log(
        runId,
        `[auth] ignoring model ${resolved.model}: it belongs to the ${requestedWire} wire, not ${wire}`,
        "warn",
      );
    }
    const modelPrimary = modelUsable ? resolved.model! : configuredModel;
    const modelFallback =
      wire === "openai" ? config.OPENAI_MODEL_FALLBACK : config.ANTHROPIC_MODEL_FALLBACK;

    state.provider = {
      id: resolved.provider,
      label: descriptor.label,
      source: credential?.source ?? "none",
      model: credential ? modelPrimary : "fixture",
      plan: credential && "plan" in credential ? credential.plan : null,
      fixture: credential === null,
    };
    await store.write(runId, state);

    await setStage("draft-concept", {
      status: "running",
      message: credential
        ? `${descriptor.label} concept + plan (${modelPrimary})`
        : "concept + plan (fixture mode — no credential)",
    });
    const ai = createClaudeClient({
      provider: resolved.provider,
      ...(credential ? { credential } : { fixtureMode: true }),
      modelPrimary,
      modelFallback,
      configureAt: "the provider panel",
      logger: (l) => void bus.log(runId, l),
    });
    const { concept, capturePlan } = await ai.draftConceptAndPlan(analysis, {
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
      // If the deadline fired while booting, tear down immediately and abort —
      // the timeout handler ran before bootedKill was assigned. (Outside the
      // try/catch so the abort isn't swallowed as a "degraded" boot.)
      if (ac.signal.aborted) {
        if (bootedKill) await bootedKill().catch(() => {});
        bootedKill = undefined;
        throw new Error(`run exceeded MAX_RUN_SECONDS=${config.MAX_RUN_SECONDS}s`);
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

    // 7. AI provider — technical + captions + summary
    await setStage("draft-technical", {
      status: "running",
      message: credential ? `${descriptor.label} technical pass` : "technical pass (fixture mode)",
    });
    const { technical, caseBrief, captions, summary } = await ai.draftTechnicalAndCaptions(
      analysis,
      concept,
      capturePlan,
      captureManifest,
    );
    await setStage("draft-technical", { status: "done", message: `${captions.length} captions` });

    const generated: GeneratedContent = {
      concept,
      capturePlan,
      caseBrief,
      technical,
      captions,
      summary,
    };
    await writeFile(join(dir, "content.json"), JSON.stringify(generated, null, 2));

    // 8. Post-process assets
    await setStage("post-process", { status: "running", message: "WebP + thumbnails" });
    await postProcessAssets(captureManifest, join(dir, "assets"));
    await setStage("post-process", { status: "done", message: "done" });

    const renderInput = {
      runId,
      generatedAt: new Date().toISOString(),
      analysis,
      content: generated,
      capture: captureManifest,
      assetsBasePath: "./assets",
    };

    // 9. Quality gate + portable case export
    await setStage("quality-check", { status: "running", message: "validating evidence + media" });
    const qualityJsonPath = join(dir, "quality.json");
    const caseStudyJsonPath = join(dir, "case-study.json");
    const quality = await renderQualityReport(renderInput, qualityJsonPath);
    await renderCaseStudyExport(renderInput, quality, caseStudyJsonPath);
    if (quality.status === "pass") {
      await setStage("quality-check", { status: "done", message: "pass" });
    } else {
      degraded = true;
      await setStage("quality-check", { status: "degraded", message: quality.status });
      await bus.log(runId, `[quality] ${quality.summary}`, "warn");
    }

    // 10. Render
    await setStage("render", { status: "running", message: "markdown + deck + pdf" });
    const reportMdPath = join(dir, "report.md");
    const deckHtmlPath = join(dir, "deck.html");
    const deckPdfPath = join(dir, "deck.pdf");
    await renderMarkdown(renderInput, reportMdPath);
    await renderDeck(renderInput, deckHtmlPath);
    let pdfOk = false;
    try {
      await renderPdfFromDeck(deckHtmlPath, deckPdfPath);
      pdfOk = true;
    } catch (e) {
      degraded = true;
      await bus.log(runId, `[render] PDF failed: ${(e as Error).message}`, "warn");
    }
    state.artifacts = {
      reportMd: "report.md",
      deckHtml: "deck.html",
      // Only advertise the PDF when it was actually written, otherwise the UI
      // links to a 404 / zero-byte file.
      ...(pdfOk ? { deckPdf: "deck.pdf" } : {}),
      caseStudyJson: "case-study.json",
      qualityJson: "quality.json",
    };
    await setStage("render", { status: "done", message: pdfOk ? "rendered" : "rendered (no pdf)" });

    // Done. If the deadline fired while we were finishing, leave the timeout
    // failure recorded by the catch handler untouched.
    if (ac.signal.aborted) return state;
    state.state = degraded ? "partial" : "done";
    state.updatedAt = new Date().toISOString();
    await store.write(runId, state);
    await bus.publish(runId, { type: "done", state: state.state, artifacts: state.artifacts });
    return state;
    })();
    return await Promise.race([work, deadline]);
  } catch (err) {
    const msg = (err as Error).message;
    const runningStage = state.stages.find((s) => s.status === "running");
    if (runningStage) {
      runningStage.status = "failed";
      runningStage.message = msg;
      runningStage.finishedAt = new Date().toISOString();
      await bus.stage(runId, runningStage);
    }
    state.state = "failed";
    state.error = msg;
    state.updatedAt = new Date().toISOString();
    await store.write(runId, state);
    await bus.log(runId, `pipeline failed: ${msg}`, "error");
    await bus.publish(runId, { type: "error", error: msg });
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (bootedKill) await bootedKill().catch(() => {});
  }
}

/**
 * The credential for this run, or null to mean "use fixtures".
 *
 * Fixture mode is not an error path and never has been: DoceoMenter runs its own tests, its
 * own e2e and a first look at the product with no key configured anywhere, and a metered
 * provider with nothing to spend is exactly that case. A *subscription* is different — the
 * user picked a plan by name, and quietly generating fixtures instead would be a lie about
 * whose work the output is — so a missing one fails the run with the message that says how to
 * connect it.
 */
async function resolveCredential(opts: {
  provider: ResolvedRunSpec["provider"];
  accountId: string | null;
  inlineKey?: string;
  log: (line: string, level?: "info" | "warn") => void;
}): Promise<ProviderCredential | null> {
  try {
    const credential = await resolveProviderCredential({
      provider: opts.provider,
      accountId: opts.accountId,
      inlineKey: opts.inlineKey,
    });
    opts.log(`[auth] ${opts.provider} credential from ${credential.source}`);
    return credential;
  } catch (error) {
    const descriptor = describeProvider(opts.provider);
    if (error instanceof CredentialError && descriptor.kind === "key") {
      opts.log(`[auth] ${error.message} Falling back to fixture mode.`, "warn");
      return null;
    }
    throw error;
  }
}

function buildInitialState(runId: string, spec: RunSpec): RunState {
  const stages: StageState[] = STAGE_NAMES.map((name) => ({ name, status: "pending" }));
  const now = new Date().toISOString();
  return {
    runId,
    spec: redactSpec(spec),
    state: "queued",
    createdAt: now,
    updatedAt: now,
    stages,
  };
}

function parseRepoUrl(url: string): { owner: string; name: string } {
  const gh = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (gh) {
    const owner = gh[1] ?? "";
    const name = gh[2] ?? "";
    if (!owner || !name) throw new Error(`invalid GitHub URL (empty owner/name): ${url}`);
    return { owner, name };
  }
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
