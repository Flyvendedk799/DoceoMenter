import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { boot, detectStrategy, findStaticHtmlDir, suggestStaticRoutes } from "@doceomenter/boot";
import { postProcessAssets, runCapturePlan, deriveCliCommands } from "@doceomenter/capture";
import { createClaudeClient } from "@doceomenter/claude";
import {
  CredentialError,
  describeProvider,
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
  resolveEffectiveCaptureSurface,
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
import {
  shouldAttemptCliLiveCapture,
  shouldHardFailMissingLiveApp,
} from "./captureHardFail.js";
import type { WorkerConfig } from "./config.js";
import type { RunStore } from "./runStore.js";
import type { RunEventBus } from "./eventBus.js";
import { resolveRunModels } from "./resolveRunModels.js";

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
    const configuredPrimary =
      wire === "openai"
        ? config.OPENAI_MODEL_PRIMARY
        : wire === "gemini"
          ? config.GEMINI_MODEL_PRIMARY
          : config.ANTHROPIC_MODEL_PRIMARY;
    const configuredFallback =
      wire === "openai"
        ? config.OPENAI_MODEL_FALLBACK
        : wire === "gemini"
          ? config.GEMINI_MODEL_FALLBACK
          : config.ANTHROPIC_MODEL_FALLBACK;
    const { primary: modelPrimary, fallback: modelFallback, fromPanel } = resolveRunModels({
      wire,
      requestedModel: resolved.model,
      configuredPrimary,
      configuredFallback,
    });
    if (resolved.model && !fromPanel) {
      await bus.log(
        runId,
        `[auth] ignoring model ${resolved.model}: it is not usable on the ${wire} wire`,
        "warn",
      );
    }
    await bus.log(
      runId,
      `[auth] model=${modelPrimary}${
        fromPanel ? " (panel selection — no auto-fallback)" : ` fallback=${modelFallback}`
      }`,
    );

    state.provider = {
      id: resolved.provider,
      label: descriptor.label,
      source: credential?.source ?? "none",
      model: credential ? modelPrimary : "fixture",
      plan: credential && "plan" in credential ? credential.plan : null,
      fixture: credential === null,
    };
    await store.write(runId, state);

    // 4. Detect runtime before drafting the capture plan so the model knows the surface.
    await setStage("detect-runtime", { status: "running", message: "project type" });
    const strategy = detectStrategy(analysis, config.ENABLE_DOCKER_IN_DOCKER);
    const captureSurface = resolveEffectiveCaptureSurface({
      override: resolved.captureSurface,
      strategyKind: strategy.kind,
      hasFrontend: analysis.signals.hasFrontend,
      hasCLI: analysis.signals.hasCLI,
      hasElectron: analysis.signals.hasElectron,
    });
    await bus.log(
      runId,
      `[detect] strategy=${strategy.kind} surface=${captureSurface} liveMedia=${resolved.liveMedia} planMode=${resolved.capturePlanMode}`,
    );
    await setStage("detect-runtime", {
      status: "done",
      message: `${strategy.kind} · ${captureSurface}`,
    });

    await setStage("draft-concept", {
      status: "running",
      message: credential
        ? `${descriptor.label}${
            credential.kind === "subscription" && "plan" in credential && credential.plan
              ? ` (${credential.plan})`
              : ""
          } concept + plan (${modelPrimary})`
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
    const staticHtmlDir = findStaticHtmlDir(analysis);
    const suggestedRoutes = staticHtmlDir
      ? suggestStaticRoutes(analysis, staticHtmlDir)
      : undefined;
    let { concept, capturePlan } = await ai.draftConceptAndPlan(analysis, {
      includeVideo: resolved.includeVideo,
      outputStyle: resolved.outputStyle,
      liveMedia: resolved.liveMedia,
      captureSurface,
      capturePlanMode: resolved.capturePlanMode,
      captureTargets: resolved.captureTargets,
      captureBrief: resolved.captureBrief,
      ...(staticHtmlDir ? { staticHtmlDir } : {}),
      ...(suggestedRoutes && suggestedRoutes.length > 0 ? { suggestedRoutes } : {}),
    });
    // Ensure CLI/Electron runs that want live media actually have a live-app shot to capture.
    if (
      resolved.liveMedia !== "skip" &&
      (captureSurface === "cli" || captureSurface === "electron") &&
      !capturePlan.shots.some((s) => "target" in s && s.target === "live-app")
    ) {
      const cmd =
        resolved.captureTargets?.[0] ??
        deriveCliCommands({
          bin: (analysis.manifests.nodePkg as { bin?: unknown } | undefined)?.bin,
          packageName: analysis.manifests.nodePkg?.name,
        })[0] ??
        "--help";
      capturePlan = {
        shots: [
          {
            id: "cli-live",
            kind: "screenshot" as const,
            target: "live-app" as const,
            route: cmd,
            viewport: { w: 1280, h: 800 },
            caption: resolved.captureBrief || `Live CLI: ${cmd}`,
            importance: 1 as const,
          },
          ...capturePlan.shots,
        ].slice(0, 10),
      };
    }
    // Static HTML prototypes (FM-Ecommerce project/) — inject live routes if the model skipped them.
    if (
      resolved.liveMedia !== "skip" &&
      captureSurface === "browser" &&
      suggestedRoutes &&
      suggestedRoutes.length > 0 &&
      !capturePlan.shots.some((s) => "target" in s && s.target === "live-app")
    ) {
      const injected = suggestedRoutes.slice(0, 3).map((route, i) => ({
        id: i === 0 ? "live-home" : `live-${i}`,
        kind: "screenshot" as const,
        target: "live-app" as const,
        route,
        viewport: { w: 1440, h: 900 },
        caption: resolved.captureBrief || `Live page ${route}`,
        importance: (i === 0 ? 1 : 2) as 1 | 2,
      }));
      capturePlan = { shots: [...injected, ...capturePlan.shots].slice(0, 10) };
    }
    if (resolved.liveMedia === "skip") {
      capturePlan = {
        shots: capturePlan.shots.filter(
          (s) => !("target" in s && s.target === "live-app"),
        ),
      };
      if (capturePlan.shots.length === 0) {
        capturePlan = {
          shots: [
            {
              id: "github-readme",
              kind: "screenshot" as const,
              target: "github-readme" as const,
              caption: "The repository's README on GitHub.",
              importance: 1 as const,
            },
          ],
        };
      }
    }
    await writeFile(join(dir, "plan.json"), JSON.stringify({ concept, capturePlan }, null, 2));
    await setStage("draft-concept", { status: "done", message: `${capturePlan.shots.length} shots planned` });

    // 5. Boot (skipped for non-browser surfaces OR when bootApp=false / liveMedia=skip)
    let liveAppUrl: string | undefined;
    const skipBoot =
      !resolved.bootApp ||
      resolved.liveMedia === "skip" ||
      captureSurface === "cli" ||
      captureSurface === "electron" ||
      captureSurface === "none" ||
      strategy.kind === "cli" ||
      strategy.kind === "electron" ||
      strategy.kind === "library" ||
      strategy.kind === "unknown";
    if (skipBoot) {
      await setStage("boot", {
        status: "skipped",
        message: `strategy=${strategy.kind} surface=${captureSurface}`,
      });
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
        const needsLiveApp =
          resolved.liveMedia === "required" ||
          capturePlan.shots.some((shot) => "target" in shot && shot.target === "live-app");
        const message = (e as Error).message;
        if (needsLiveApp && resolved.liveMedia !== "skip") {
          await setStage("boot", { status: "failed", message });
          console.error(`[boot] hard fail (live-app shots planned): ${message}`);
          throw new Error(
            `Boot failed and the capture plan needs live-app media — cannot continue: ${message}`,
            { cause: e },
          );
        }
        degraded = true;
        await setStage("boot", { status: "degraded", message });
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
    const pkg = analysis.manifests.nodePkg as
      | { bin?: unknown; name?: string }
      | undefined;
    const cliCommands = deriveCliCommands({
      bin: pkg?.bin,
      packageName: pkg?.name,
      captureTargets: resolved.captureTargets,
    });
    const useCliLive = shouldAttemptCliLiveCapture({
      liveMedia: resolved.liveMedia,
      surface: captureSurface,
      liveAppUrl,
    });
    if (useCliLive) {
      await bus.log(runId, `[capture] CLI/TUI live via terminal screenshots (${cliCommands[0]})`);
    }
    const captureManifest: CaptureManifest = await runCapturePlan(capturePlan, {
      ...(liveAppUrl ? { liveAppUrl } : {}),
      ...(useCliLive
        ? {
            cliLive: {
              repoDir,
              commands: cliCommands,
              outDir: join(dir, "assets"),
              log: (l: string) => void bus.log(runId, l),
            },
          }
        : {}),
      ownerRepo: `${owner}/${name}`,
      outDir: join(dir, "assets"),
      log: (l) => void bus.log(runId, l),
    });
    const okCount = captureManifest.entries.filter((e) => e.status === "ok").length;
    const liveOk = captureManifest.entries.filter(
      (e) =>
        e.status === "ok" && "target" in e.shot && e.shot.target === "live-app",
    ).length;
    const plannedLive = capturePlan.shots.filter(
      (shot) => "target" in shot && shot.target === "live-app",
    ).length;
    if (okCount === 0) {
      await setStage("capture", { status: "failed", message: "no shots succeeded" });
      console.error(`[capture] hard fail: no shots succeeded (${captureManifest.entries.length} planned)`);
      throw new Error(
        "Media capture produced no successful shots — Playwright/media capture is required.",
      );
    }
    if (
      shouldHardFailMissingLiveApp({
        plannedLive,
        liveOk,
        liveAppUrl,
        liveMedia: resolved.liveMedia,
        surface: captureSurface,
      })
    ) {
      await setStage("capture", {
        status: "failed",
        message: `0/${plannedLive} live-app ok`,
      });
      console.error(
        `[capture] hard fail: planned ${plannedLive} live-app shot(s) but none succeeded (surface=${captureSurface} url=${liveAppUrl ?? "none"})`,
      );
      throw new Error(
        `Media capture failed for live-app shots (0/${Math.max(plannedLive, 1)} ok) — live media is ${resolved.liveMedia} for surface=${captureSurface}.`,
      );
    }
    if (plannedLive > 0 && liveOk === 0 && !liveAppUrl && !useCliLive) {
      console.error(
        `[capture] no live capture for ${plannedLive} shot(s) (strategy=${strategy.kind} surface=${captureSurface}); continuing`,
      );
    }
    if (okCount < captureManifest.entries.length) {
      degraded = true;
      await setStage("capture", {
        status: "degraded",
        message: `${okCount}/${captureManifest.entries.length} ok`,
      });
    } else {
      await setStage("capture", {
        status: "done",
        message: `${okCount}/${captureManifest.entries.length} ok`,
      });
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
    } else if (quality.status === "fail") {
      // Missing live product media (or other hard gates) must fail the run.
      await setStage("quality-check", { status: "failed", message: quality.status });
      await bus.log(runId, `[quality] ${quality.summary}`, "error");
      console.error(`[quality] hard fail: ${quality.summary}`);
      throw new Error(`Quality gate failed: ${quality.summary}`);
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
      // Discovery steps (`[code-assist] …`) land in the same Worker log the run UI shows.
      log: (line) => opts.log(line),
    });
    opts.log(`[auth] ${opts.provider} credential from ${credential.source}`);
    if (credential.kind === "subscription" && credential.provider === "gemini-cli") {
      // `plan` is the Google account email for Antigravity — log it so ops can confirm which
      // personal identity a 429/403 actually spent, not just which browser cookie started the run.
      const account = credential.plan?.trim() || "(email unknown)";
      const via =
        credential.source === "local-cli"
          ? "machine agy login"
          : credential.source === "account"
            ? "provider-panel connect"
            : credential.source;
      const identityLine = `[auth] Antigravity account=${account} via=${via}`;
      opts.log(identityLine);
      // stderr: ServerHoster reliably captures console.error (same channel as [code-assist]
      // and the old AUTH DIAGNOSTIC). console.info was invisible in service logs.
      console.error(identityLine);
      const projectLog =
        `[auth] antigravity project=${credential.projectId ?? "(none)"}` +
        `${credential.bodyOnlyProjectId ? ` bodyProject=${credential.bodyOnlyProjectId}` : ""}` +
        ` dogfood=${credential.isDogfood ? "yes" : "no"}` +
        ` headerProject=${credential.projectId ? "yes" : "no"}`;
      console.error(projectLog);
      opts.log(projectLog);
      if (!credential.projectId && credential.bodyOnlyProjectId) {
        opts.log(
          `[auth] Antigravity will send project=${credential.bodyOnlyProjectId} in the request body only (no x-goog-user-project) on the ${credential.isDogfood ? "daily" : "prod"} host`,
          "warn",
        );
      } else if (!credential.projectId && !credential.bodyOnlyProjectId) {
        opts.log(
          `[auth] Antigravity has no Cloud Code project for this login — generateContent will omit project (often looks like a false 429)`,
          "warn",
        );
      }
    }
    if (credential.kind === "subscription" && credential.provider === "claude-code" && credential.plan) {
      opts.log(`[auth] Claude plan=${credential.plan} via=${credential.source}`);
    }
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
