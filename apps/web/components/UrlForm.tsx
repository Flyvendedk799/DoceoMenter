"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const URL_RE = /^https?:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?\/?$/;

export function UrlForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [outputStyle, setOutputStyle] = useState<"concise" | "standard" | "deep">("standard");
  const [includeVideo, setIncludeVideo] = useState(true);
  const [bootApp, setBootApp] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function onSubmit(e: React.FormEvent) {
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
          apiKey: apiKey || undefined,
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
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex gap-2">
        <input
          type="url"
          required
          aria-label="GitHub repository URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {submitting ? "Starting…" : "Generate"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <details open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-400">Advanced</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span>Branch / ref</span>
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Output style</span>
            <select
              value={outputStyle}
              onChange={(e) => setOutputStyle(e.target.value as typeof outputStyle)}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="concise">Concise</option>
              <option value="standard">Standard</option>
              <option value="deep">Deep</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeVideo} onChange={(e) => setIncludeVideo(e.target.checked)} />
            <span>Include video walkthrough</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={bootApp} onChange={(e) => setBootApp(e.target.checked)} />
            <span>Boot the app (uncheck for libraries)</span>
          </label>
          <label className="col-span-full flex flex-col gap-1">
            <span>Anthropic API key (optional, BYOK)</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1 font-mono dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>
      </details>
    </form>
  );
}
