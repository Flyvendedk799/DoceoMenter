"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseStudyExport, QualityReport, RunState } from "@doceomenter/shared";
import { MarkdownDoc, outline, wordCount } from "../lib/markdown";

type View = "report" | "deck" | "data";

const TABS: Array<{ id: View; label: string }> = [
  { id: "report", label: "report.md" },
  { id: "deck", label: "deck.html" },
  { id: "data", label: "json" },
];

/**
 * The generated package, read in the same language it was written in.
 *
 * Three surfaces over the artifacts on disk: the report as a typeset document
 * rather than a download, the deck driven live in its own frame, and the two
 * JSON payloads shown as what they are. Nothing here re-derives content — every
 * panel reads the file the worker wrote, so what a stakeholder sees on this page
 * is exactly what leaves in the zip.
 */
export function OutputsViewer({ state }: { state: RunState }) {
  const [view, setView] = useState<View>("report");
  const artifacts = state.artifacts ?? {};
  const fileUrl = useCallback(
    (path: string) => `/api/runs/${state.runId}/files/${path.split("/").map(encodeURIComponent).join("/")}`,
    [state.runId],
  );

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-7 px-5 pb-28 pt-11 sm:px-7">
      <header className="flex flex-wrap items-end gap-5">
        <div className="flex min-w-[260px] flex-1 flex-col gap-3">
          <span className="font-mono text-[11px] uppercase tracking-eyebrow text-fg-faint">
            Run {state.runId} · {state.state}
          </span>
          <h1 className="m-0 break-all font-display text-[clamp(30px,5vw,58px)] font-normal leading-[1.02] tracking-[-.02em]">
            {state.spec.url.replace(/^https?:\/\//, "").replace(/\/$/, "")} — case package
          </h1>
        </div>
        <Link href={`/run/${state.runId}`} className="dm-btn-secondary no-underline">
          Back to the run
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-4 border-b border-line pb-3.5">
        <div className="flex gap-1 rounded-pill border border-white/10 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              aria-pressed={view === tab.id}
              className={`h-8 rounded-pill px-4 font-mono text-[13px] tracking-[.04em] transition-[background,color] duration-control ease-house ${
                view === tab.id ? "bg-accent/10 text-accent" : "text-fg-muted hover:text-fg"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-[11px] text-fg-faint">
          output templates · same tokens as the product surface
        </span>
      </div>

      {view === "report" ? (
        <ReportView path={artifacts.reportMd} fileUrl={fileUrl} />
      ) : view === "deck" ? (
        <DeckView htmlPath={artifacts.deckHtml} pdfPath={artifacts.deckPdf} fileUrl={fileUrl} />
      ) : (
        <DataView
          caseStudyPath={artifacts.caseStudyJson}
          qualityPath={artifacts.qualityJson}
          fileUrl={fileUrl}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ report */

function ReportView({
  path,
  fileUrl,
}: {
  path?: string;
  fileUrl: (path: string) => string;
}) {
  const [markdown, setMarkdown] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [active, setActive] = useState<string | undefined>();

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    fetch(fileUrl(path), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`report.md returned HTTP ${res.status}`);
        return res.text();
      })
      .then(setMarkdown)
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    return () => controller.abort();
  }, [path, fileUrl]);

  const sections = useMemo(() => (markdown ? outline(markdown) : []), [markdown]);
  const figures = useMemo(() => (markdown ? (markdown.match(/^!\[/gm) ?? []).length : 0), [markdown]);
  const words = useMemo(() => (markdown ? wordCount(markdown) : 0), [markdown]);

  // Track the section under the top of the viewport so the contents rail says
  // where the reader is rather than only where they can go.
  useEffect(() => {
    if (sections.length === 0) return;
    const onScroll = () => {
      let current = sections[0]?.slug;
      for (const section of sections) {
        const el = document.getElementById(section.slug);
        if (el && el.getBoundingClientRect().top <= 140) current = section.slug;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [sections]);

  if (!path) return <Empty>No report was written for this run.</Empty>;
  if (error) return <Empty tone="fail">{error}</Empty>;
  if (!markdown) return <Empty>Loading report…</Empty>;

  // Assets are written relative to the run directory, which is exactly what the
  // file route serves — so `./assets/screenshots/x.png` needs only a prefix.
  const resolveSrc = (src: string) => {
    if (/^(https?:)?\/\//.test(src) || src.startsWith("data:")) return src;
    return fileUrl(src.replace(/^\.\//, ""));
  };

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center gap-3.5">
        <span className="font-mono text-[11px] tracking-[.2em] text-accent">report.md</span>
        <span className="font-mono text-[11px] text-fg-faint">
          {words.toLocaleString("en-US").replace(/,/g, " ")} words · {figures} figure
          {figures === 1 ? "" : "s"} · rendered preview
        </span>
        <span className="ml-auto flex gap-2">
          <a
            href={fileUrl(path)}
            target="_blank"
            rel="noreferrer"
            className="dm-btn-secondary h-9 px-4 text-[13px] no-underline"
          >
            View raw
          </a>
          <a href={fileUrl(path)} download className="dm-btn h-9 px-[18px] text-[13px] no-underline">
            Download
          </a>
        </span>
      </div>

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_220px]">
        <article className="dm-card flex min-w-0 flex-col gap-6 p-[clamp(24px,4vw,64px)]">
          <MarkdownDoc markdown={markdown} options={{ resolveSrc }} />
        </article>

        <aside className="hidden flex-col gap-3 lg:sticky lg:top-24 lg:flex">
          <span className="font-mono text-[10.5px] uppercase tracking-[.2em] text-fg-faint">
            Contents
          </span>
          {sections.map((section) => (
            <a
              key={section.slug}
              href={`#${section.slug}`}
              className={`border-l py-[3px] pl-3 text-[13.5px] leading-[1.5] no-underline transition-colors duration-micro ${
                active === section.slug
                  ? "border-accent text-accent"
                  : "border-white/10 text-fg-faint hover:text-fg-muted"
              }`}
            >
              {section.text}
            </a>
          ))}
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- deck */

type Slide = { index: number; title: string };

function DeckView({
  htmlPath,
  pdfPath,
  fileUrl,
}: {
  htmlPath?: string;
  pdfPath?: string;
  fileUrl: (path: string) => string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [current, setCurrent] = useState(0);

  /**
   * The deck is a Reveal document on this origin, so it can simply be driven:
   * its own API moves the slides and its own markup names them. Re-implementing
   * a slide list here would be a second source of truth that drifts the first
   * time the deck template changes.
   */
  const attach = useCallback(() => {
    const win = frame.current?.contentWindow as (Window & { Reveal?: any }) | null;
    const doc = frame.current?.contentDocument;
    if (!win || !doc) return;

    const read = () => {
      const sections = Array.from(doc.querySelectorAll(".slides > section"));
      setSlides(
        sections.map((section, index) => ({
          index,
          title:
            section.getAttribute("data-title") ||
            section.querySelector("h1, h2, h3")?.textContent?.trim() ||
            `Slide ${index + 1}`,
        })),
      );
      if (win.Reveal?.getIndices) setCurrent(win.Reveal.getIndices().h ?? 0);
    };

    read();
    if (win.Reveal?.on) {
      win.Reveal.on("slidechanged", (event: { indexh?: number }) => setCurrent(event.indexh ?? 0));
    } else {
      // Reveal initialises from an inline script at the end of the document; if
      // it has not run yet, look again shortly rather than giving up.
      window.setTimeout(read, 400);
    }
  }, []);

  const go = (index: number) => {
    const win = frame.current?.contentWindow as (Window & { Reveal?: any }) | null;
    if (win?.Reveal?.slide) win.Reveal.slide(index, 0);
    setCurrent(index);
  };

  if (!htmlPath) return <Empty>No deck was rendered for this run.</Empty>;

  const total = slides.length;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3.5">
        <span className="font-mono text-[11px] tracking-[.2em] text-accent">deck.html</span>
        <span className="font-mono text-[11px] text-fg-faint">
          {total ? `slide ${current + 1} of ${total}` : "loading deck"}
          {pdfPath ? " · also exported as deck.pdf" : ""}
        </span>
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            aria-label="Previous slide"
            onClick={() => go(Math.max(0, current - 1))}
            className="dm-btn-secondary h-9 w-11 px-0 text-[15px]"
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Next slide"
            onClick={() => go(total ? Math.min(total - 1, current + 1) : current + 1)}
            className="dm-btn-secondary h-9 w-11 px-0 text-[15px]"
          >
            →
          </button>
          <a
            href={fileUrl(htmlPath)}
            target="_blank"
            rel="noreferrer"
            className="dm-btn h-9 px-[18px] text-[13px] no-underline"
          >
            Open full screen
          </a>
        </span>
      </div>

      <div className="relative aspect-[16/10] overflow-hidden rounded-[22px] border border-white/10 bg-ink-900 shadow-float">
        <iframe
          ref={frame}
          onLoad={attach}
          src={fileUrl(htmlPath)}
          title="Generated presentation"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>

      {total > 0 && (
        <div className="flex flex-wrap gap-2.5">
          {slides.map((slide) => (
            <button
              key={slide.index}
              type="button"
              onClick={() => go(slide.index)}
              className={`min-w-[120px] flex-1 rounded-sm border px-3.5 py-3 text-left font-mono text-[11px] tracking-[.1em] transition-[border-color,background,color] duration-control ease-house ${
                current === slide.index
                  ? "border-accent/45 bg-accent/[.08] text-accent"
                  : "border-white/10 bg-transparent text-fg-faint hover:border-white/20"
              }`}
            >
              <span className="block truncate">
                {String(slide.index + 1).padStart(2, "0")} {slide.title.toUpperCase()}
              </span>
            </button>
          ))}
        </div>
      )}

      {pdfPath && (
        <a
          href={fileUrl(pdfPath)}
          download
          className="font-mono text-[11.5px] text-accent no-underline hover:text-accent-bright"
        >
          Download deck.pdf →
        </a>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- json */

function DataView({
  caseStudyPath,
  qualityPath,
  fileUrl,
}: {
  caseStudyPath?: string;
  qualityPath?: string;
  fileUrl: (path: string) => string;
}) {
  const [caseStudy, setCaseStudy] = useState<CaseStudyExport | undefined>();
  const [quality, setQuality] = useState<QualityReport | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const controller = new AbortController();
    const load = async <T,>(path: string | undefined, set: (value: T) => void) => {
      if (!path) return;
      const res = await fetch(fileUrl(path), { signal: controller.signal });
      if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
      set((await res.json()) as T);
    };
    Promise.all([
      load<CaseStudyExport>(caseStudyPath, setCaseStudy),
      load<QualityReport>(qualityPath, setQuality),
    ]).catch((e) => {
      if (!controller.signal.aborted) setError((e as Error).message);
    });
    return () => controller.abort();
  }, [caseStudyPath, qualityPath, fileUrl]);

  if (!caseStudyPath && !qualityPath) return <Empty>This run produced no JSON payloads.</Empty>;
  if (error) return <Empty tone="fail">{error}</Empty>;

  const degraded = quality?.checks.filter((check) => check.status !== "pass") ?? [];

  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] tracking-[.2em] text-accent">case-study.json</span>
          <span className="font-mono text-[11px] text-fg-faint">
            portfolio payload{caseStudy ? ` · ${caseStudy.portfolio.media.length} media` : ""}
          </span>
          {caseStudyPath && (
            <a
              href={fileUrl(caseStudyPath)}
              download
              className="ml-auto font-mono text-[11px] text-accent no-underline hover:text-accent-bright"
            >
              download →
            </a>
          )}
        </div>
        <JsonWell value={caseStudy} />
      </div>

      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] tracking-[.2em] text-accent">quality.json</span>
          <span className="font-mono text-[11px] text-fg-faint">
            evidence gate{quality ? ` · run marked ${quality.status}` : ""}
          </span>
          {qualityPath && (
            <a
              href={fileUrl(qualityPath)}
              download
              className="ml-auto font-mono text-[11px] text-accent no-underline hover:text-accent-bright"
            >
              download →
            </a>
          )}
        </div>
        <JsonWell value={quality} />

        {degraded.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-warn/30 bg-warn/[.07] px-5 py-5">
            <span className="font-mono text-[11px] tracking-label text-warn">
              {degraded.some((check) => check.status === "fail")
                ? "FAILED CHECK · BLOCKING"
                : "DEGRADED · NON-BLOCKING"}
            </span>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[14px] leading-[1.65] text-[#D8C9A6]">
              {degraded.map((check) => (
                <li key={check.id}>
                  <span className="font-semibold">{check.label}</span> — {check.detail}
                </li>
              ))}
            </ul>
            <span className="text-[13px] leading-[1.6] text-fg-muted">
              The deck and the report both state this rather than hiding it, and the gap is listed
              in the evidence register.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function JsonWell({ value }: { value: unknown }) {
  return (
    <pre className="dm-well m-0 max-h-[62vh] overflow-auto rounded-lg p-6 text-[12.5px] leading-[1.85] text-[#B8C0C8]">
      <code>{value === undefined ? "loading…" : JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}

function Empty({ children, tone }: { children: React.ReactNode; tone?: "fail" }) {
  return (
    <p
      className={`dm-card m-0 px-6 py-8 text-center text-[14px] ${
        tone === "fail" ? "border-fail/30 text-fail" : "text-fg-muted"
      }`}
    >
      {children}
    </p>
  );
}

