import type {
  Analysis,
  CaptureManifest,
  CapturePlan,
  Caption,
  Concept,
  Summary,
  Technical,
} from "@doceomenter/shared";
import type { ClaudeClient } from "./client.js";

/**
 * Deterministic fixture client used when ANTHROPIC_API_KEY is absent.
 * Produces plausible structured outputs derived from the static analysis,
 * sufficient for end-to-end pipeline verification.
 */
export function createFixtureClient(): ClaudeClient {
  return {
    async draftConceptAndPlan(a, callOpts) {
      const concept = buildConcept(a);
      const capturePlan = buildPlan(a, callOpts.includeVideo);
      return { concept, capturePlan };
    },

    async draftTechnicalAndCaptions(a, _concept, capturePlan, manifest) {
      const technical = buildTechnical(a);
      const successful = manifest.entries.filter((e) => e.status === "ok");
      const captions: Caption[] = successful.map((e) => {
        const shot = capturePlan.shots.find((s) => s.id === e.shotId) ?? e.shot;
        return {
          shotId: e.shotId,
          markdown: `${"caption" in shot ? shot.caption : "Captured view"} — see ${
            a.repo.owner
          }/${a.repo.name}.`,
        };
      });
      const summary: Summary = {
        oneLiner: `${a.repo.name}: ${shortPurpose(a)}`.slice(0, 140),
        tldr: [
          `Stack detected: ${stackSummary(a)}`,
          `Entry points: ${a.entrypoints.slice(0, 2).join(", ") || "n/a"}`,
          `${manifest.entries.length} capture(s); ${successful.length} succeeded`,
        ].map((s) => s.slice(0, 120)),
      };
      return { technical, captions, summary };
    },
  };
}

function shortPurpose(a: Analysis): string {
  const headings = a.readme?.firstNHeadings ?? [];
  const fromReadme = headings.find((h) => h.length > 4 && h.length < 80);
  if (fromReadme) return fromReadme;
  if (a.signals.framework && a.signals.framework !== "unknown") {
    return `a ${a.signals.framework} project`;
  }
  return "a software project";
}

function stackSummary(a: Analysis): string {
  const langs = Object.keys(a.languages).slice(0, 3).join(" + ") || "unknown";
  const fw = a.signals.framework && a.signals.framework !== "unknown"
    ? ` (${a.signals.framework})`
    : "";
  return `${langs}${fw}`;
}

function buildConcept(a: Analysis): Concept {
  const purpose = shortPurpose(a);
  const what = `${a.repo.name} is ${purpose}. Static analysis detects ${
    a.fileCount
  } files (${formatBytes(a.sizeBytes)}) with primary languages ${
    Object.keys(a.languages).slice(0, 3).join(", ") || "unknown"
  }. ${a.signals.hasFrontend ? "It exposes a runnable frontend. " : ""}${
    a.signals.hasBackend ? "It includes server-side code. " : ""
  }${a.signals.isLibrary ? "It is consumable as a library. " : ""}This summary is grounded in the repository's manifests and README headings.`;

  const why = a.readme?.rawTrimmed
    ? `The README opens with: "${
        firstSentence(a.readme.rawTrimmed)
      }" — which signals the project's intent. The presence of ${manifestSummary(
        a,
      )} corroborates that focus, and entry points such as ${a.entrypoints
        .slice(0, 2)
        .join(", ") || "(none recorded)"} reflect the surface available to users.`
    : `No README narrative was recorded; the project's purpose is inferred from manifests and file layout (${manifestSummary(
        a,
      )}). Vision not stated in source.`;

  const vision = a.readme?.firstNHeadings?.length
    ? `The README headings (${a.readme.firstNHeadings.slice(0, 4).join(" / ")}) suggest planned scope. Beyond those, vision not stated in source.`
    : `Vision not stated in source.`;

  const audience: string[] = [];
  if (a.signals.hasFrontend) audience.push("End users of the rendered UI");
  if (a.signals.hasBackend) audience.push("Operators / API consumers");
  if (a.signals.isLibrary) audience.push("Developers integrating the library");
  if (a.signals.hasCLI) audience.push("Engineers using the CLI");
  if (audience.length === 0) audience.push("Engineers reading the source");

  return { what, why, vision, audience: audience.slice(0, 5) };
}

function buildPlan(a: Analysis, includeVideo: boolean): CapturePlan {
  const shots: CapturePlan["shots"] = [];

  if (a.signals.hasFrontend) {
    shots.push({
      id: "live-home",
      kind: "screenshot",
      target: "live-app",
      route: "/",
      viewport: { w: 1440, h: 900 },
      caption: "The application's home view.",
      importance: 1,
    });
    shots.push({
      id: "live-home-full",
      kind: "screenshot",
      target: "live-app",
      route: "/",
      viewport: { w: 1440, h: 900 },
      fullPage: true,
      caption: "Full-page scroll of the home view.",
      importance: 2,
    });
  }

  shots.push({
    id: "github-readme",
    kind: "screenshot",
    target: "github-readme",
    caption: "The repository's README on GitHub.",
    importance: 2,
  });

  if (a.signals.hasBackend || a.fileCount > 50) {
    shots.push({
      id: "arch-diagram",
      kind: "screenshot",
      target: "code-architecture",
      diagramSpec: { mermaid: buildMermaid(a) },
      caption: "High-level component diagram inferred from manifests.",
      importance: 1,
    });
  }

  if (includeVideo && a.signals.hasFrontend) {
    shots.push({
      id: "live-walkthrough",
      kind: "video",
      target: "live-app",
      route: "/",
      script: [
        { do: "wait", ms: 600 },
        { do: "scrollTo", selector: "body" },
        { do: "wait", ms: 1500 },
      ],
      maxDurationMs: 8000,
      caption: "A short scroll through the running application.",
    });
  }

  return { shots };
}

function buildMermaid(a: Analysis): string {
  const nodes: string[] = [];
  const edges: string[] = [];
  if (a.signals.hasFrontend) nodes.push("FE[Frontend]");
  if (a.signals.hasBackend) nodes.push("BE[Backend]");
  if (a.signals.hasCLI) nodes.push("CLI[CLI]");
  if (a.signals.isLibrary) nodes.push("LIB[Library API]");
  if (a.signals.hasFrontend && a.signals.hasBackend) edges.push("FE --> BE");
  if (a.signals.hasCLI && a.signals.isLibrary) edges.push("CLI --> LIB");
  if (a.signals.hasBackend && a.signals.isLibrary) edges.push("BE --> LIB");
  if (nodes.length === 0) nodes.push("REPO[Repository]");
  return ["graph LR", ...nodes, ...edges].join("\n");
}

function buildTechnical(a: Analysis): Technical {
  const stack: Technical["stack"] = [];
  if (a.manifests.nodePkg) {
    stack.push({
      technology: `Node (${a.manifests.nodePkg.name})`,
      evidence: "package.json:1",
    });
    for (const d of a.manifests.nodePkg.deps.slice(0, 6)) {
      stack.push({ technology: d, evidence: `package.json (dependencies)` });
    }
  }
  if (a.manifests.pythonPyproject) {
    stack.push({ technology: "Python (pyproject.toml)", evidence: "pyproject.toml:1" });
  }
  if (a.manifests.dockerfile) {
    stack.push({ technology: "Docker", evidence: "Dockerfile:1" });
  }
  if (stack.length === 0) {
    stack.push({ technology: "(stack not determined from source)", evidence: "n/a" });
  }

  const architecture =
    `The repository contains ${a.fileCount} files across ${
      Object.keys(a.languages).length
    } languages. ${
      a.signals.framework && a.signals.framework !== "unknown"
        ? `Detected framework: ${a.signals.framework}.`
        : ""
    } ${
      a.signals.hasFrontend && a.signals.hasBackend
        ? "Frontend and backend code coexist in this repo."
        : a.signals.hasFrontend
          ? "Frontend-only project."
          : a.signals.hasBackend
            ? "Backend-only project."
            : a.signals.isLibrary
              ? "Library project: consumed by other code, no runtime surface."
              : "Project structure not classified beyond manifests."
    } Entry points: ${a.entrypoints.slice(0, 3).join(", ") || "(none recorded)"}.`;

  const dataFlow =
    `Data flow not deeply traced from static analysis; inferred from manifests and entry points (${
      a.entrypoints.slice(0, 2).join(", ") || "n/a"
    }). ${a.manifests.dockerfile ? "A Dockerfile is present, suggesting containerized deployment." : ""}`;

  const keyModules: Technical["keyModules"] = [];
  for (const ep of a.entrypoints.slice(0, 4)) {
    keyModules.push({
      path: ep,
      role: "entry point",
      oneLineSummary: `Entry point referenced by manifests.`,
      citations: [`${ep}:1`],
    });
  }
  if (keyModules.length === 0) {
    keyModules.push({
      path: "(none)",
      role: "—",
      oneLineSummary: "No clear entry point found in static analysis.",
      citations: [],
    });
  }

  const gettingStarted: string[] = [];
  if (a.manifests.nodePkg?.scripts.dev) {
    gettingStarted.push(`pnpm install`);
    gettingStarted.push(`pnpm dev`);
  } else if (a.manifests.nodePkg?.scripts.start) {
    gettingStarted.push(`npm install`);
    gettingStarted.push(`npm start`);
  } else if (a.manifests.pythonPyproject || a.manifests.pythonRequirements) {
    gettingStarted.push(`pip install -r requirements.txt`);
  } else {
    gettingStarted.push(`# Build/run commands not determined from source`);
  }

  return {
    stack: stack.slice(0, 8),
    architecture,
    dataFlow,
    keyModules: keyModules.slice(0, 6),
    gettingStarted,
  };
}

function manifestSummary(a: Analysis): string {
  const items: string[] = [];
  if (a.manifests.nodePkg) items.push("a package.json");
  if (a.manifests.pythonPyproject) items.push("a pyproject.toml");
  if (a.manifests.pythonRequirements) items.push("a requirements.txt");
  if (a.manifests.dockerfile) items.push("a Dockerfile");
  if (a.manifests.composeYml) items.push("a docker-compose.yml");
  return items.length > 0 ? items.join(", ") : "no recognized manifests";
}

function firstSentence(s: string): string {
  const m = s.match(/[^.!?\n]{20,300}[.!?]/);
  if (m) return m[0].trim();
  return s.slice(0, 200).trim();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`;
}
