"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const URL_RE = /^https?:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?\/?$/;
const PROVIDERS = [
  { value: "claude", label: "Claude", caption: "Anthropic" },
  { value: "openai", label: "OpenAI", caption: "GPT models" },
] as const;

const OUTPUT_STYLES = [
  { value: "concise", label: "Concise", caption: "Fast brief" },
  { value: "standard", label: "Standard", caption: "Balanced" },
  { value: "deep", label: "Deep", caption: "Reference case" },
] as const;

export function UrlForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [outputStyle, setOutputStyle] = useState<"concise" | "standard" | "deep">("standard");
  const [includeVideo, setIncludeVideo] = useState(true);
  const [bootApp, setBootApp] = useState(true);
  const [provider, setProvider] = useState<"claude" | "openai">("claude");
  const [apiKeys, setApiKeys] = useState<Record<"claude" | "openai", string>>({ claude: "", openai: "" });
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const activeApiKey = apiKeys[provider];
  const providerLabel = useMemo(() => PROVIDERS.find((p) => p.value === provider)?.label ?? "Provider", [provider]);

  useEffect(() => {
    const raw = window.localStorage.getItem("doceomenter.profile");
    if (!raw) return;
    try {
      const profile = JSON.parse(raw) as { provider?: "claude" | "openai"; apiKeys?: Partial<Record<"claude" | "openai", string>> };
      if (profile.provider === "claude" || profile.provider === "openai") setProvider(profile.provider);
      setApiKeys((current) => ({ ...current, ...profile.apiKeys }));
    } catch {
      window.localStorage.removeItem("doceomenter.profile");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("doceomenter.profile", JSON.stringify({ provider, apiKeys }));
  }, [provider, apiKeys]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!URL_RE.test(url.trim())) {
      setError("Must be of the form https://github.com/<owner>/<repo>");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          ref,
          outputStyle,
          includeVideo,
          bootApp,
          provider,
          apiKey: activeApiKey || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { runId } = (await res.json()) as { runId: string };
      router.push(`/run/${runId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Onboarding</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Repository intake + profile</h2>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-sky-100 px-2.5 py-1 font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">
              Playwright capture
            </span>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              Quality gate
            </span>
          </div>
        </div>

        <section className="rounded-md border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">Your AI provider profile</h3>
              <p className="mt-1 text-sm text-emerald-900/75 dark:text-emerald-200/75">
                Choose Claude or OpenAI once, add your BYOK API key, and update it any time before starting a run. Keys are stored only in this browser profile and sent with the run request.
              </p>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 shadow-sm dark:bg-emerald-500/10 dark:text-emerald-200">
              Active: {providerLabel}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PROVIDERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setProvider(item.value)}
                aria-pressed={provider === item.value}
                className={`rounded-md border px-3 py-3 text-left transition ${
                  provider === item.value
                    ? "border-emerald-500 bg-white text-emerald-950 shadow-sm dark:border-emerald-400 dark:bg-emerald-500/10 dark:text-emerald-100"
                    : "border-emerald-200/80 bg-white/60 text-zinc-800 hover:border-emerald-300 dark:border-emerald-900 dark:bg-zinc-950/40 dark:text-zinc-200"
                }`}
              >
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{item.caption}</span>
              </button>
            ))}
          </div>
          <label className="mt-4 flex flex-col gap-2">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{providerLabel} API key</span>
            <input
              type="password"
              autoComplete="off"
              value={activeApiKey}
              onChange={(e) => setApiKeys((current) => ({ ...current, [provider]: e.target.value }))}
              placeholder={provider === "openai" ? "sk-..." : "sk-ant-..."}
              className="h-10 rounded-md border border-zinc-300 bg-white px-3 font-mono text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </section>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="min-w-0 space-y-2">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              GitHub repository URL
            </span>
            <input
              type="url"
              required
              aria-label="GitHub repository URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="h-12 w-full rounded-md border border-zinc-300 bg-white px-3 text-base outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="h-12 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            {submitting ? "Starting..." : "Generate"}
          </button>
        </div>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {OUTPUT_STYLES.map((style) => (
            <button
              key={style.value}
              type="button"
              onClick={() => setOutputStyle(style.value)}
              aria-pressed={outputStyle === style.value}
              className={`rounded-md border px-3 py-3 text-left transition ${
                outputStyle === style.value
                  ? "border-emerald-500 bg-emerald-50 text-emerald-950 shadow-sm dark:border-emerald-400 dark:bg-emerald-500/10 dark:text-emerald-100"
                  : "border-zinc-200 bg-zinc-50 text-zinc-800 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-700"
              }`}
            >
              <span className="block text-sm font-semibold">{style.label}</span>
              <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                {style.caption}
              </span>
            </button>
          ))}
        </div>

        <details
          open={advanced}
          onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}
          className="rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/60"
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Advanced controls
          </summary>
          <div className="grid grid-cols-1 gap-4 border-t border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">Branch / ref</span>
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                className="h-10 rounded-md border border-zinc-300 bg-white px-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>

            <div className="flex flex-col gap-2">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">Capture settings</span>
              <label className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
                <span>Include video walkthrough</span>
                <input
                  className="h-4 w-4 accent-emerald-600"
                  type="checkbox"
                  checked={includeVideo}
                  onChange={(e) => setIncludeVideo(e.target.checked)}
                />
              </label>
              <label className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
                <span>Boot the app</span>
                <input
                  className="h-4 w-4 accent-emerald-600"
                  type="checkbox"
                  checked={bootApp}
                  onChange={(e) => setBootApp(e.target.checked)}
                />
              </label>
            </div>

            <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 sm:col-span-2">
              Provider and API key live in your profile at the top of this form, so you can switch between Claude and OpenAI without opening advanced controls.
            </div>
          </div>
        </details>
      </div>
    </form>
  );
}
