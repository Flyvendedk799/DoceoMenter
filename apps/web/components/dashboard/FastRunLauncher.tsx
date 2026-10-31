"use client";

import React, { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { AuthStatus } from "@doceomenter/auth";
import type { AiProvider } from "@doceomenter/shared";
import {
  firstReadyProvider,
  readSavedProviderChoice,
  saveProviderChoice,
  type ProviderChoice,
} from "../providerChoice";

const URL_RE = /^https?:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?\/?$/;

const OUTPUT_STYLES = [
  { value: "concise", label: "Concise" },
  { value: "standard", label: "Standard" },
  { value: "deep", label: "Deep" },
] as const;

const PROVIDER_OPTIONS: Array<{ value: AiProvider; label: string }> = [
  { value: "anthropic", label: "Anthropic Key" },
  { value: "claude-code", label: "Claude Code" },
  { value: "openai", label: "OpenAI Key" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini Key" },
  { value: "gemini-cli", label: "Antigravity" },
];

/**
 * Which provider the launcher opens on: the browser's saved preference (the same one the main
 * form's provider panel writes), else the first provider that is ready, else Anthropic.
 */
export function resolveLauncherChoice(
  saved: ProviderChoice | null,
  status: Pick<AuthStatus, "providers"> | null,
): ProviderChoice {
  if (saved) return saved;
  return (status && firstReadyProvider(status)) ?? { provider: "anthropic" };
}

/**
 * A warning for a provider that has no credential, or null. Such a run is not refused — the
 * worker falls back to deterministic fixtures — so say so before it is dispatched.
 */
export function providerWarning(
  provider: AiProvider,
  status: Pick<AuthStatus, "providers"> | null,
): string | null {
  const entry = status?.providers.find((p) => p.id === provider);
  if (!entry || entry.ready) return null;
  return `${entry.label} is not set up, so this run will produce fixture output instead of a model's. Connect it from the home page, or pick a provider marked Ready.`;
}

export interface FastRunLauncherProps {
  isOpen?: boolean;
  onToggle?: () => void;
  onRunCreated?: (runId: string) => void;
  initialRunId?: string | null;
}

export async function dispatchRun(spec: {
  url: string;
  ref?: string;
  outputStyle?: "concise" | "standard" | "deep";
  includeVideo?: boolean;
  bootApp?: boolean;
  provider?: AiProvider;
  model?: string;
}): Promise<{ runId: string }> {
  const trimmedUrl = spec.url.trim();
  if (!URL_RE.test(trimmedUrl)) {
    throw new Error("Must be a valid GitHub repo URL (e.g. https://github.com/owner/repo)");
  }
  const res = await fetch("/api/runs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: trimmedUrl,
      ref: spec.ref?.trim() || "main",
      outputStyle: spec.outputStyle || "standard",
      includeVideo: spec.includeVideo ?? true,
      bootApp: spec.bootApp ?? true,
      provider: spec.provider || "anthropic",
      ...(spec.model ? { model: spec.model } : {}),
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return (await res.json()) as { runId: string };
}

export function FastRunLauncher({
  isOpen,
  onToggle,
  onRunCreated,
  initialRunId = null,
}: FastRunLauncherProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const toggleOpen = onToggle ?? (() => setInternalOpen((prev) => !prev));

  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [outputStyle, setOutputStyle] = useState<"concise" | "standard" | "deep">("standard");
  const [includeVideo, setIncludeVideo] = useState(true);
  const [bootApp, setBootApp] = useState(true);
  const [choice, setChoice] = useState<ProviderChoice>({ provider: "anthropic" });
  const [providerStatus, setProviderStatus] = useState<AuthStatus | null>(null);
  /** Set once a saved preference is restored or the user picks, so readiness never overrides it. */
  const chosen = useRef(false);
  const provider = choice.provider;

  useEffect(() => {
    let cancelled = false;
    const saved = readSavedProviderChoice(window.localStorage);
    if (saved) {
      chosen.current = true;
      setChoice(saved);
    }
    void (async () => {
      try {
        const res = await fetch("/api/providers", { credentials: "same-origin" });
        if (!res.ok) return;
        const status = (await res.json()) as AuthStatus;
        if (cancelled) return;
        setProviderStatus(status);
        if (!chosen.current) setChoice(resolveLauncherChoice(null, status));
      } catch {
        // Readiness is advisory here; the select still works without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectProvider = (next: AiProvider) => {
    const entry = providerStatus?.providers.find((p) => p.id === next);
    const nextChoice: ProviderChoice = { provider: next, model: entry?.defaultModel };
    chosen.current = true;
    setChoice(nextChoice);
    saveProviderChoice(window.localStorage, nextChoice);
  };

  const warning = providerWarning(provider, providerStatus);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCreatedRunId, setLastCreatedRunId] = useState<string | null>(initialRunId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLastCreatedRunId(null);

    setSubmitting(true);
    try {
      const data = await dispatchRun({
        url,
        ref,
        outputStyle,
        includeVideo,
        bootApp,
        provider,
        model: choice.model,
      });

      setLastCreatedRunId(data.runId);
      setUrl("");
      onRunCreated?.(data.runId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="fast-run-launcher"
      className="dm-card overflow-hidden transition-all duration-control"
    >
      {/* Header bar / Toggle */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-ink-800 border-b border-line">
        <div className="flex items-center gap-3">
          <span className="dm-eyebrow text-accent">RAPID DISPATCH</span>
          <span className="text-[14px] font-semibold text-fg">Fast Run Launcher</span>
        </div>
        <button
          type="button"
          data-testid="launcher-toggle-btn"
          onClick={toggleOpen}
          aria-expanded={open}
          className="dm-btn-secondary h-8 px-3.5 text-[12px] font-mono"
        >
          {open ? "Close Launcher –" : "+ Fast Run Launcher"}
        </button>
      </div>

      {/* Success Notification */}
      {lastCreatedRunId && (
        <div
          data-testid="launcher-success-alert"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-accent/20 bg-accent/10 px-5 py-3 text-[13px] text-accent"
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold">Run successfully dispatched!</span>
            <span className="font-mono text-[12px]">ID: {lastCreatedRunId}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/run/${lastCreatedRunId}`}
              className="dm-btn h-7 px-3 text-[12px] no-underline"
            >
              Open Live Run →
            </Link>
          </div>
        </div>
      )}

      {/* Error Notification */}
      {error && (
        <div
          data-testid="launcher-error-alert"
          className="border-b border-fail/30 bg-fail/[.08] px-5 py-2.5 text-[13px] text-fail"
        >
          {error}
        </div>
      )}

      {/* Collapsible drawer content */}
      {open && (
        <form
          onSubmit={handleSubmit}
          data-testid="fast-run-form"
          className="flex flex-col gap-5 p-5 bg-ink-850"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Repo URL */}
            <div className="md:col-span-2 flex flex-col gap-1.5">
              <label htmlFor="launcher-url" className="dm-label text-fg-faint">
                GITHUB REPOSITORY URL *
              </label>
              <input
                id="launcher-url"
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repository"
                className="dm-input h-10 text-[13px]"
              />
            </div>

            {/* Branch / Ref */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="launcher-ref" className="dm-label text-fg-faint">
                BRANCH / REF
              </label>
              <input
                id="launcher-ref"
                type="text"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="main"
                className="dm-input h-10 text-[13px]"
              />
            </div>

            {/* Output Style */}
            <div className="flex flex-col gap-1.5">
              <span className="dm-label text-fg-faint">OUTPUT STYLE</span>
              <div className="flex gap-2">
                {OUTPUT_STYLES.map((style) => (
                  <button
                    key={style.value}
                    type="button"
                    onClick={() => setOutputStyle(style.value)}
                    aria-pressed={outputStyle === style.value}
                    className={`flex-1 h-10 rounded-sm border px-2 text-[12px] font-medium transition-colors ${
                      outputStyle === style.value
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-line bg-ink-900 text-fg-muted hover:border-white/20"
                    }`}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Provider */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="launcher-provider" className="dm-label text-fg-faint">
                PROVIDER &amp; BILLING
              </label>
              <select
                id="launcher-provider"
                value={provider}
                onChange={(e) => selectProvider(e.target.value as AiProvider)}
                className="dm-input h-10 cursor-pointer text-[13px]"
              >
                {PROVIDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-ink-800 text-fg">
                    {opt.label}
                    {providerStatus?.providers.find((p) => p.id === opt.value)?.ready
                      ? " · Ready"
                      : ""}
                  </option>
                ))}
              </select>
              {warning && (
                <p
                  data-testid="launcher-provider-warning"
                  role="status"
                  className="m-0 text-[12px] leading-[1.5] text-warn"
                >
                  {warning}
                </p>
              )}
            </div>

            {/* Media & Boot Toggles */}
            <div className="flex flex-col gap-1.5">
              <span className="dm-label text-fg-faint">EXECUTION TOGGLES</span>
              <div className="flex flex-wrap gap-3 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-[12.5px] text-fg-soft">
                  <input
                    type="checkbox"
                    checked={includeVideo}
                    onChange={(e) => setIncludeVideo(e.target.checked)}
                    className="h-4 w-4 rounded border-line accent-[var(--accent)]"
                  />
                  <span>Record Video</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-[12.5px] text-fg-soft">
                  <input
                    type="checkbox"
                    checked={bootApp}
                    onChange={(e) => setBootApp(e.target.checked)}
                    className="h-4 w-4 rounded border-line accent-[var(--accent)]"
                  />
                  <span>Boot Browser App</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
            <button
              type="button"
              onClick={toggleOpen}
              className="dm-btn-secondary h-10 px-5 text-[13px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="launcher-submit-btn"
              disabled={submitting}
              className="dm-btn h-10 px-6 text-[13.5px]"
            >
              {submitting ? "Dispatching…" : "Dispatch Run"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
