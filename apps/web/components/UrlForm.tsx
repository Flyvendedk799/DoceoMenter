"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ProviderPanel, type ProviderChoice } from "./ProviderPanel";

const URL_RE = /^https?:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?\/?$/;

const OUTPUT_STYLES = [
  { value: "concise", label: "Concise", caption: "fast brief" },
  { value: "standard", label: "Standard", caption: "balanced" },
  { value: "deep", label: "Deep", caption: "reference case" },
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
  const [setupNote, setSetupNote] = useState("checking credentials…");
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
    <form onSubmit={onSubmit} className="w-full max-w-[720px]">
      {/* The hero's floating panel — one of the two places in the system that
          carries a shadow, because it genuinely hovers over the gradient. */}
      <div className="flex flex-wrap gap-2.5 rounded-[20px] border border-white/[.12] bg-ink-800/70 p-2.5 shadow-float backdrop-blur-[24px]">
        <input
          id="repo-url"
          type="url"
          required
          aria-label="GitHub repository URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="h-[54px] min-w-[240px] flex-1 border-none bg-transparent px-3.5 font-mono text-[15px] text-fg outline-none placeholder:text-fg-faint"
        />
        <button
          type="submit"
          disabled={submitting}
          className="dm-btn h-[54px] rounded-[14px] px-7 text-[15px]"
        >
          {submitting ? "Starting…" : "Generate case"}
        </button>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-x-6 gap-y-1.5 pl-1 font-mono text-[11.5px] text-fg-faint">
        <span>BYOK · Claude or OpenAI</span>
        <span>No key → fixture mode</span>
        <span>Screenshots {includeVideo ? "+ video" : "only"}</span>
      </div>

      {error && (
        <p className="mt-4 rounded-sm border border-fail/30 bg-fail/[.08] px-4 py-3 text-[13.5px] leading-[1.6] text-fail">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2.5">
        {OUTPUT_STYLES.map((style) => (
          <button
            key={style.value}
            type="button"
            onClick={() => setOutputStyle(style.value)}
            aria-pressed={outputStyle === style.value}
            className={`flex-1 basis-[140px] rounded-sm border px-3.5 py-3 text-left transition-[border-color,background] duration-control ease-house ${
              outputStyle === style.value
                ? "border-accent/50 bg-accent/[.08] text-fg"
                : "border-white/[.12] bg-transparent text-fg-muted hover:border-white/25"
            }`}
          >
            <span className="block text-[13px] font-semibold">{style.label}</span>
            <span className="mt-1 block font-mono text-[11px] text-fg-faint">{style.caption}</span>
          </button>
        ))}
      </div>

      <details
        open={advanced}
        onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}
        className="dm-card mt-4 overflow-hidden bg-ink-800/60"
      >
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-[13.5px] font-medium text-fg-muted transition-colors duration-micro hover:text-fg">
          <span className="font-mono text-[11px] tracking-label text-fg-faint">RUN SETUP</span>
          <span className="ml-auto font-mono text-[11px] text-fg-faint">{setupNote}</span>
          <span aria-hidden className="text-fg-faint">
            {advanced ? "–" : "+"}
          </span>
        </summary>

        <div className="flex flex-col gap-5 border-t border-line p-5">
          <ProviderPanel value={choice} onChange={setChoice} onSummary={setSetupNote} />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[11px] tracking-label text-fg-faint">BRANCH / REF</span>
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                className="dm-input h-11 text-[13px]"
              />
            </label>

            <div className="flex flex-col gap-2">
              <span className="font-mono text-[11px] tracking-label text-fg-faint">CAPTURE</span>
              <Toggle label="Include video walkthrough" checked={includeVideo} onChange={setIncludeVideo} />
              <Toggle label="Boot the app" checked={bootApp} onChange={setBootApp} />
            </div>
          </div>

          <p className="m-0 text-[13px] leading-[1.65] text-fg-faint">
            Credentials stay on the server: a connected subscription and a stored key are both
            encrypted at rest, and neither is ever sent back to this page.
          </p>
        </div>
      </details>
    </form>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-sm border px-3.5 text-[13.5px] transition-[border-color,background] duration-control ease-house ${
        checked ? "border-accent/40 bg-accent/[.06] text-fg" : "border-line bg-ink-900 text-fg-muted"
      }`}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[color:var(--accent)]"
      />
    </label>
  );
}
