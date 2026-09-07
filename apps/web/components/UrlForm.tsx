"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ProviderPanel, type ProviderChoice } from "./ProviderPanel";

const URL_RE = /^https?:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?\/?$/;

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
  // Opens on the metered provider because that is the one option that always *works*: with no
  // key anywhere it degrades to the deterministic fixture client, so a first visit with nothing
  // configured still produces a pack. The panel moves this to whatever is actually connected.
  const [choice, setChoice] = useState<ProviderChoice>({ provider: "anthropic" });
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

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
          provider: choice.provider,
          model: choice.model,
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
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Repository intake + provider</h2>
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

        <ProviderPanel value={choice} onChange={setChoice} />

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
              The provider, its credential and the model live in the panel at the top of this form.
              Credentials stay on the server: a connected subscription and a stored key are both
              encrypted at rest, and neither is ever sent back to this page.
            </div>
          </div>
        </details>
      </div>
    </form>
  );
}
