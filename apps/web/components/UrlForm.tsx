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

const LIVE_MEDIA = [
  { value: "if-possible", label: "If possible", caption: "best effort" },
  { value: "required", label: "Required", caption: "fail if missing" },
  { value: "skip", label: "Skip", caption: "no live media" },
] as const;

const SURFACES = [
  { value: "auto", label: "Auto" },
  { value: "browser", label: "Browser" },
  { value: "cli", label: "CLI / TUI" },
  { value: "electron", label: "Electron" },
  { value: "none", label: "None" },
] as const;

const PLAN_MODES = [
  { value: "auto", label: "Let AI choose", caption: "model plans shots" },
  { value: "guided", label: "Guided", caption: "routes / commands" },
  { value: "brief", label: "Free-text", caption: "describe what to show" },
] as const;

export function UrlForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [outputStyle, setOutputStyle] = useState<"concise" | "standard" | "deep">("standard");
  const [includeVideo, setIncludeVideo] = useState(true);
  const [bootApp, setBootApp] = useState(true);
  const [liveMedia, setLiveMedia] = useState<"required" | "if-possible" | "skip">("if-possible");
  const [captureSurface, setCaptureSurface] = useState<
    "auto" | "browser" | "electron" | "cli" | "none"
  >("auto");
  const [capturePlanMode, setCapturePlanMode] = useState<"auto" | "guided" | "brief">("auto");
  const [captureTargetsText, setCaptureTargetsText] = useState("");
  const [captureBrief, setCaptureBrief] = useState("");
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
      const captureTargets = captureTargetsText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 20);
      const res = await fetch("/api/runs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          ref,
          outputStyle,
          includeVideo,
          bootApp,
          liveMedia,
          captureSurface,
          capturePlanMode,
          ...(capturePlanMode === "guided" && captureTargets.length > 0
            ? { captureTargets }
            : {}),
          ...(capturePlanMode === "brief" && captureBrief.trim()
            ? { captureBrief: captureBrief.trim().slice(0, 2000) }
            : {}),
          provider: choice.provider,
          // Always send an explicit model when one is known — omitting it lets a stale
          // server GEMINI_MODEL_* env override what the panel showed.
          ...(choice.model ? { model: choice.model } : {}),
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

  const liveLabel =
    liveMedia === "skip" ? "no live media" : liveMedia === "required" ? "live required" : "live if possible";

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
        <span>
          Screenshots {includeVideo ? "+ video" : "only"} · {liveLabel}
        </span>
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
              <span className="font-mono text-[11px] tracking-label text-fg-faint">MEDIA TOGGLES</span>
              <Toggle label="Include video walkthrough" checked={includeVideo} onChange={setIncludeVideo} />
              <Toggle label="Boot browser app" checked={bootApp} onChange={setBootApp} />
            </div>
          </div>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 font-mono text-[11px] tracking-label text-fg-faint">
              LIVE PRODUCT MEDIA
            </legend>
            <p className="mb-3 mt-0 text-[12.5px] leading-[1.55] text-fg-faint">
              Browser apps get Playwright screenshots. CLI/TUI gets a terminal capture of real
              command output. Electron is detected; window capture is not ready yet, so we fall
              back to CLI/dev commands when possible.
            </p>
            <div className="flex flex-wrap gap-2">
              {LIVE_MEDIA.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setLiveMedia(opt.value)}
                  aria-pressed={liveMedia === opt.value}
                  className={`min-w-[120px] flex-1 rounded-sm border px-3 py-2.5 text-left transition-[border-color,background] duration-control ease-house ${
                    liveMedia === opt.value
                      ? "border-accent/50 bg-accent/[.08] text-fg"
                      : "border-line bg-ink-900 text-fg-muted hover:border-white/25"
                  }`}
                >
                  <span className="block text-[13px] font-semibold">{opt.label}</span>
                  <span className="mt-0.5 block font-mono text-[11px] text-fg-faint">{opt.caption}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 font-mono text-[11px] tracking-label text-fg-faint">
              PRODUCT SURFACE
            </legend>
            <div className="flex flex-wrap gap-2">
              {SURFACES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCaptureSurface(opt.value)}
                  aria-pressed={captureSurface === opt.value}
                  className={`rounded-sm border px-3 py-2 text-[13px] transition-[border-color,background] duration-control ease-house ${
                    captureSurface === opt.value
                      ? "border-accent/50 bg-accent/[.08] text-fg"
                      : "border-line bg-ink-900 text-fg-muted hover:border-white/25"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 font-mono text-[11px] tracking-label text-fg-faint">
              CAPTURE PLAN
            </legend>
            <div className="mb-3 flex flex-wrap gap-2">
              {PLAN_MODES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCapturePlanMode(opt.value)}
                  aria-pressed={capturePlanMode === opt.value}
                  className={`min-w-[120px] flex-1 rounded-sm border px-3 py-2.5 text-left transition-[border-color,background] duration-control ease-house ${
                    capturePlanMode === opt.value
                      ? "border-accent/50 bg-accent/[.08] text-fg"
                      : "border-line bg-ink-900 text-fg-muted hover:border-white/25"
                  }`}
                >
                  <span className="block text-[13px] font-semibold">{opt.label}</span>
                  <span className="mt-0.5 block font-mono text-[11px] text-fg-faint">{opt.caption}</span>
                </button>
              ))}
            </div>

            {capturePlanMode === "guided" && (
              <label className="flex flex-col gap-2">
                <span className="font-mono text-[11px] tracking-label text-fg-faint">
                  TARGETS (one per line — routes, CLI commands, or window hints)
                </span>
                <textarea
                  value={captureTargetsText}
                  onChange={(e) => setCaptureTargetsText(e.target.value)}
                  rows={4}
                  placeholder={"/\n/dashboard\nnode dist/cli.js --help"}
                  className="dm-input min-h-[96px] resize-y py-3 font-mono text-[12.5px] leading-[1.5]"
                />
              </label>
            )}

            {capturePlanMode === "brief" && (
              <label className="flex flex-col gap-2">
                <span className="font-mono text-[11px] tracking-label text-fg-faint">
                  FREE-TEXT BRIEF
                </span>
                <textarea
                  value={captureBrief}
                  onChange={(e) => setCaptureBrief(e.target.value)}
                  rows={4}
                  placeholder="Show the OAuth paste flow in the terminal, then the connected state."
                  className="dm-input min-h-[96px] resize-y py-3 text-[13px] leading-[1.55]"
                />
              </label>
            )}
          </fieldset>

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
        className="h-4 w-4 accent-[var(--accent)]"
      />
    </label>
  );
}
