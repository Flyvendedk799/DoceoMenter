import { UrlForm } from "../components/UrlForm";
import { ScrollChoreography } from "../components/ScrollChoreography";

const STAGES = [
  { n: "01", name: "Intake", body: "URL validated, size checked, job queued on Redis." },
  { n: "02", name: "Clone", body: "Shallow clone at the chosen ref, installs run with scripts ignored." },
  { n: "03", name: "Analyze", body: "Project type, entry points, key modules and dependency graph." },
  { n: "04", name: "Narrate", body: "Claude or OpenAI writes concept, vision, stack and module notes." },
  { n: "05", name: "Boot", body: "A strategy per project type brings the thing up on a local port." },
  { n: "06", name: "Capture", body: "Playwright screenshots each route; optional walkthrough video." },
  { n: "07", name: "Audit", body: "Quality gate scores evidence and marks the run done or partial." },
  { n: "08", name: "Render", body: "Markdown, Reveal deck and print-quality PDF from one source." },
  { n: "09", name: "Export", body: "Case-study JSON shaped for portfolio and publishing tools." },
];

const ARTIFACTS = [
  {
    file: "report.md",
    title: "Written report",
    body: "Concept, vision, technical stack, key modules and getting started — each section grounded in files that exist.",
  },
  {
    file: "deck.html",
    title: "Reveal presentation",
    body: "Self-contained HTML deck built from the report and the captured media.",
  },
  {
    file: "deck.pdf",
    title: "Print export",
    body: "The same deck rendered at print quality for sharing and archival.",
  },
  {
    file: "case-study.json",
    title: "Portfolio payload",
    body: "Narrative, metrics, media references and tech stack in a portable shape.",
  },
  {
    file: "quality.json",
    title: "Evidence gate",
    body: "The checks that decided whether this run counts as done or partial.",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-ink-900 text-fg">
      <ScrollChoreography />

      <section className="relative flex min-h-[calc(100vh-57px)] flex-col justify-center overflow-hidden px-5 sm:px-7">
        {/* Atmosphere: three drifting fields, a grid that fades at the edges, and
            one slow sweep. Everything here loops at 11s or slower so it reads as
            weather rather than as activity. */}
        <div
          data-mesh
          aria-hidden
          className="pointer-events-none absolute -inset-[15%] opacity-[.62] blur-[70px] will-change-transform"
        >
          <div className="absolute left-[4%] top-[18%] h-[46vw] w-[46vw] animate-drift rounded-full bg-[radial-gradient(circle,#0E8C99_0%,rgba(14,140,153,0)_62%)]" />
          <div className="absolute right-[2%] top-[4%] h-[40vw] w-[40vw] animate-drift2 rounded-full bg-[radial-gradient(circle,#2B4C7E_0%,rgba(43,76,126,0)_62%)]" />
          <div className="absolute bottom-[-14%] left-[34%] h-[36vw] w-[52vw] animate-drift rounded-full bg-[radial-gradient(circle,#5AD8E6_0%,rgba(90,216,230,0)_60%)] opacity-[.55] [animation-direction:reverse] [animation-duration:44s]" />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(14,16,19,.55)_0%,rgba(14,16,19,.15)_40%,rgba(14,16,19,.95)_100%)]" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(255,255,255,.028)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.028)_1px,transparent_1px)] [background-size:74px_74px] [mask-image:radial-gradient(ellipse_at_50%_45%,#000_20%,transparent_78%)]"
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 h-[180px] animate-sweep bg-[linear-gradient(180deg,transparent,rgba(90,216,230,.055),transparent)]" />
        </div>

        <div className="relative mx-auto flex w-full max-w-[1180px] flex-col gap-8 py-24 lg:py-32">
          <div
            className="dm-pill self-start border-accent/30 bg-accent/[.07] py-[7px] pl-3 pr-4 text-accent"
            style={{ animation: "dmRise .8s cubic-bezier(.16,1,.3,1) .05s both" }}
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-accent"
              style={{ animation: "dmPulse 3s ease-in-out infinite" }}
            />
            Nine stages · real browser capture
          </div>

          <h1 className="m-0 max-w-[16ch] font-display text-[clamp(52px,8.4vw,124px)] font-normal leading-[.94] tracking-[-.025em]">
            <span className="block" style={{ animation: "dmRise 1s cubic-bezier(.16,1,.3,1) .12s both" }}>
              A repository URL in.
            </span>
            <span className="block" style={{ animation: "dmRise 1s cubic-bezier(.16,1,.3,1) .24s both" }}>
              A documented case out.
            </span>
          </h1>

          <p
            className="m-0 max-w-[56ch] text-[clamp(16px,1.5vw,19px)] leading-[1.65] text-fg-soft"
            style={{ animation: "dmRise 1s cubic-bezier(.16,1,.3,1) .36s both" }}
          >
            DoceoMenter clones the repo, boots it in headless Chromium, captures what it actually
            looks like running, and writes the report, the deck and the PDF around that evidence.
          </p>

          <div style={{ animation: "dmRise 1s cubic-bezier(.16,1,.3,1) .48s both" }}>
            <UrlForm />
          </div>
        </div>

        <div
          aria-hidden
          className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2.5 font-mono text-[10.5px] tracking-[.22em] text-fg-faint lg:flex"
          style={{ animation: "dmFade 1.4s ease 1s both" }}
        >
          <span>THE PIPELINE</span>
          <span className="h-[26px] w-px animate-nudge bg-[linear-gradient(#5AD8E6,transparent)]" />
        </div>
      </section>

      <section className="mx-auto flex max-w-[1180px] flex-col gap-14 px-5 py-24 sm:px-7 lg:py-28">
        <div className="dm-reveal flex flex-col gap-4">
          <span className="font-mono text-[11px] tracking-eyebrow text-accent">01 — WHAT RUNS</span>
          <h2 className="m-0 max-w-[20ch] font-display text-[clamp(34px,4.4vw,58px)] font-normal leading-[1.05] tracking-[-.02em]">
            Nine stages, streamed as they happen.
          </h2>
        </div>
        <div className="dm-grid-hair grid-cols-1 rounded-[20px] sm:grid-cols-2 lg:grid-cols-3">
          {STAGES.map((stage) => (
            <div key={stage.n} className="dm-reveal flex min-h-[150px] flex-col gap-2.5 px-6 py-[26px]">
              <span className="font-mono text-[11px] text-fg-faint">{stage.n}</span>
              <span className="text-[17px] font-semibold">{stage.name}</span>
              <span className="text-[13.5px] leading-[1.6] text-fg-muted">{stage.body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-ink-850">
        <div className="mx-auto grid max-w-[1180px] items-start gap-14 px-5 py-24 sm:px-7 lg:grid-cols-2 lg:py-28">
          <div className="dm-reveal flex flex-col gap-5 lg:sticky lg:top-[110px]">
            <span className="font-mono text-[11px] tracking-eyebrow text-accent">02 — WHAT YOU GET</span>
            <h2 className="m-0 font-display text-[clamp(34px,4.4vw,58px)] font-normal leading-[1.05] tracking-[-.02em]">
              Five artifacts per run.
            </h2>
            <p className="m-0 max-w-[44ch] text-[16px] leading-[1.7] text-fg-muted">
              Each one is written from the same analysis pass, so the deck, the report and the
              portfolio payload never disagree with each other.
            </p>
          </div>
          <div className="flex flex-col gap-3.5">
            {ARTIFACTS.map((artifact) => (
              <article key={artifact.file} className="dm-card dm-reveal flex items-start gap-5 p-6">
                <span className="w-[120px] shrink-0 pt-[3px] font-mono text-[11.5px] text-accent">
                  {artifact.file}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mb-1.5 block text-[17px] font-semibold">{artifact.title}</span>
                  <span className="block text-[14px] leading-[1.6] text-fg-muted">{artifact.body}</span>
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto flex max-w-[1180px] flex-col items-center gap-7 px-5 py-28 text-center sm:px-7">
        <p className="dm-reveal m-0 max-w-[24ch] font-display text-[clamp(32px,4.6vw,60px)] leading-[1.08] tracking-[-.02em]">
          Documentation nobody had to write.
        </p>
        <a href="#repo-url" className="dm-btn h-[52px] px-[30px] text-[15px] no-underline">
          Start a run
        </a>
      </section>

      <footer className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-4 border-t border-line px-5 py-9 sm:px-7">
        <span className="font-mono text-[11.5px] text-fg-faint">
          DoceoMenter · built on the v1 design system
        </span>
        <a
          href="https://github.com/Flyvendedk799/DoceoMenter"
          target="_blank"
          rel="noreferrer"
          className="ml-auto font-mono text-[11.5px] text-accent no-underline hover:text-accent-bright"
        >
          Source →
        </a>
      </footer>
    </main>
  );
}
