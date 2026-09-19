import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Analysis, Manifest, ProductSurface } from "@doceomenter/shared";

const MAX_SURFACES = 8;
const SNIPPET_CAP = 280;
const HTML_READ_CAP = 48_000;

/** Prefer landing / storefront pages over obscure templates. */
const HTML_PRIORITY = [
  /^project\/Landing\.html$/i,
  /^Landing\.html$/i,
  /^index\.html$/i,
  /^public\/index\.html$/i,
  /^project\/index\.html$/i,
  /\/Landing\.html$/i,
  /\/(home|shop|store|katalog|kategorier|courses?|kurser)\.html$/i,
  /^project\/[^/]+\.html$/i,
  /^admin\/[^/]+\.html$/i,
  /^client\/[^/]+\.html$/i,
  /^frontend\/[^/]+\.html$/i,
];

/**
 * Collect end-user product identity signals (titles, meta, headings, package
 * descriptions) so concept drafting is not dominated by agent-handoff READMEs.
 */
export async function collectProductSurfaces(opts: {
  repoDir: string;
  fileIndex: Analysis["fileIndex"];
  manifests: Manifest;
  log: (line: string) => void;
}): Promise<ProductSurface[]> {
  const out: ProductSurface[] = [];

  const pkgDesc = opts.manifests.nodePkg
    ? await readPackageDescription(opts.repoDir, opts.manifests)
    : undefined;
  if (pkgDesc) {
    out.push({
      path: pkgDesc.path,
      kind: "package-description",
      text: clip(pkgDesc.text, SNIPPET_CAP),
    });
  }

  const htmlPaths = pickHtmlPaths(opts.fileIndex.map((f) => f.path));
  for (const rel of htmlPaths) {
    if (out.length >= MAX_SURFACES) break;
    const full = join(opts.repoDir, rel);
    if (!existsSync(full)) continue;
    try {
      const raw = await readFile(full, "utf-8");
      const excerpt = extractHtmlIdentity(raw.slice(0, HTML_READ_CAP));
      if (!excerpt) continue;
      out.push({
        path: rel,
        kind: "html-identity",
        title: excerpt.title,
        description: excerpt.description,
        text: clip(excerpt.text, SNIPPET_CAP),
      });
    } catch (e) {
      opts.log(`[analyze] product surface ${rel}: ${(e as Error).message}`);
    }
  }

  // Lightweight intent from design/chat transcripts (first heading + first user ask).
  const chat = await readFirstChatIntent(opts.repoDir, opts.fileIndex.map((f) => f.path));
  if (chat && out.length < MAX_SURFACES) {
    out.push(chat);
  }

  opts.log(`[analyze] product surfaces: ${out.length}`);
  return out.slice(0, MAX_SURFACES);
}

export function extractHtmlIdentity(html: string): {
  title?: string;
  description?: string;
  text: string;
} | undefined {
  const title = attrOrTag(html, /<title[^>]*>([^<]{2,160})<\/title>/i);
  const metaDesc =
    metaContent(html, "description") ??
    metaContent(html, "og:description") ??
    metaContent(html, "twitter:description");
  const ogTitle = metaContent(html, "og:title") ?? metaContent(html, "twitter:title");
  const h1 = firstHeading(html);

  const parts = [title ?? ogTitle, metaDesc, h1].filter(Boolean) as string[];
  if (parts.length === 0) return undefined;

  const text = parts.join(" — ");
  return {
    ...(title || ogTitle ? { title: (title ?? ogTitle)! } : {}),
    ...(metaDesc ? { description: metaDesc } : {}),
    text,
  };
}

function pickHtmlPaths(paths: string[]): string[] {
  const html = paths.filter(
    (p) => /\.html?$/i.test(p) && !p.includes("node_modules/") && !/(^|\/)404\.html$/i.test(p),
  );
  const scored = html.map((p) => ({ p, s: htmlScore(p) }));
  scored.sort((a, b) => b.s - a.s || a.p.length - b.p.length);
  // Cap reads — a few identity pages beat dozens of near-duplicates.
  return scored.slice(0, 6).map((x) => x.p);
}

function htmlScore(p: string): number {
  for (let i = 0; i < HTML_PRIORITY.length; i++) {
    if (HTML_PRIORITY[i]!.test(p)) return 1000 - i * 10;
  }
  if (/Landing|index|home|shop|store|katalog|kategorier|kurs/i.test(p)) return 200;
  return 10;
}

async function readPackageDescription(
  repoDir: string,
  manifests: Manifest,
): Promise<{ path: string; text: string } | undefined> {
  const dir = manifests.packageDir && manifests.packageDir !== "." ? manifests.packageDir : ".";
  const rel = dir === "." ? "package.json" : `${dir}/package.json`;
  const full = join(repoDir, rel);
  if (!existsSync(full)) return undefined;
  try {
    const pkg = JSON.parse(await readFile(full, "utf-8")) as {
      name?: string;
      description?: string;
    };
    const desc = (pkg.description ?? "").trim();
    if (desc.length < 8) return undefined;
    const name = pkg.name ? `${pkg.name}: ${desc}` : desc;
    return { path: rel, text: name };
  } catch {
    return undefined;
  }
}

async function readFirstChatIntent(
  repoDir: string,
  paths: string[],
): Promise<ProductSurface | undefined> {
  const chat = paths
    .filter((p) => /^chats\/.+\.md$/i.test(p) || /^chat(s)?\/.+\.md$/i.test(p))
    .sort((a, b) => a.localeCompare(b))[0];
  if (!chat) return undefined;
  const full = join(repoDir, chat);
  if (!existsSync(full)) return undefined;
  try {
    const raw = (await readFile(full, "utf-8")).slice(0, 6_000);
    const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
    // First substantial user paragraph after "## User"
    const userBlock = raw.split(/##\s+User\b/i)[1] ?? "";
    const userAsk = userBlock
      .split(/##\s+/)[0]
      ?.replace(/^\s*_*Started[^_\n]*_*\s*/i, "")
      .replace(/\[[^\]]+\]/g, "")
      .trim()
      .split(/\n\n+/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .find((p) => p.length > 40);
    const parts = [heading, userAsk ? clip(userAsk, 220) : undefined].filter(Boolean) as string[];
    if (parts.length === 0) return undefined;
    return {
      path: chat,
      kind: "design-intent",
      title: heading,
      text: parts.join(" — "),
    };
  } catch {
    return undefined;
  }
}

function metaContent(html: string, name: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${escapeReg(name)}["'][^>]+content=["']([^"']{2,240})["'][^>]*>|<meta[^>]+content=["']([^"']{2,240})["'][^>]+(?:name|property)=["']${escapeReg(name)}["'][^>]*>`,
    "i",
  );
  const m = html.match(re);
  const v = (m?.[1] ?? m?.[2] ?? "").replace(/\s+/g, " ").trim();
  return v || undefined;
}

function attrOrTag(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  const v = (m?.[1] ?? "").replace(/\s+/g, " ").trim();
  return v || undefined;
}

function firstHeading(html: string): string | undefined {
  // Prefer visible h1 text; strip nested tags.
  const m = html.match(/<h1\b[^>]*>([\s\S]{2,240}?)<\/h1>/i);
  if (!m?.[1]) return undefined;
  const text = m[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 3 ? text : undefined;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
