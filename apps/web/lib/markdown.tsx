import type { ReactNode } from "react";

/**
 * A small Markdown reader for the report preview.
 *
 * It is deliberately not a general Markdown engine: it understands exactly the
 * constructs `@doceomenter/render` emits — headings, tables, fenced code,
 * bullet and nested bullet lists, block quotes, images, links, and the three
 * inline runs — and renders them as React elements. Building elements rather
 * than an HTML string is the point: report text is model output about a
 * stranger's repository, and it should never be able to reach the DOM as
 * markup, however the upstream escaping behaves on a given day.
 */

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; lang?: string; code: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "table"; head: string[]; rows: string[][]; align: Array<"left" | "right" | "center"> }
  | { kind: "figure"; alt: string; src: string; href?: string }
  | { kind: "rule" }
  | { kind: "paragraph"; text: string };

export type ListItem = { text: string; children: string[] };

export type Outline = { text: string; slug: string; level: number };

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^(`{3,})(\w*)\s*$/;
const BULLET = /^([ \t]*)[-*]\s+(.*)$/;
const ORDERED = /^([ \t]*)\d+[.)]\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LONE_IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const LINKED_IMAGE = /^\[!\[([^\]]*)\]\(([^)\s]+)\)\]\(([^)\s]+)\)$/;

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  /** Reading past the end is the normal way these loops terminate. */
  const at = (index: number) => lines[index] ?? "";
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = at(i);

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code. The closing fence must be at least as long as the opening
    // one, which is how the renderer escapes content containing backticks.
    const fence = FENCE.exec(line);
    if (fence) {
      const ticks = fence[1] ?? "```";
      const closing = new RegExp(`^\`{${ticks.length},}\\s*$`);
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !closing.test(at(i))) {
        body.push(at(i));
        i += 1;
      }
      i += 1; // consume the closing fence
      blocks.push({ kind: "code", lang: fence[2] || undefined, code: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "#").length,
        text: (heading[2] ?? "").trim(),
      });
      i += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    const linked = LINKED_IMAGE.exec(line.trim());
    if (linked?.[2] && linked[3]) {
      blocks.push({ kind: "figure", alt: linked[1] ?? "", src: linked[2], href: linked[3] });
      i += 1;
      continue;
    }
    const image = LONE_IMAGE.exec(line.trim());
    if (image?.[2]) {
      blocks.push({ kind: "figure", alt: image[1] ?? "", src: image[2] });
      i += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && at(i).startsWith(">")) {
        quote.push(at(i).replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", lines: quote });
      continue;
    }

    // A table is a header row followed by a divider row.
    if (line.includes("|") && i + 1 < lines.length && TABLE_DIVIDER.test(at(i + 1))) {
      const head = splitRow(line);
      const align = splitRow(at(i + 1)).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        if (left && right) return "center" as const;
        if (right) return "right" as const;
        return "left" as const;
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && at(i).includes("|") && at(i).trim() !== "") {
        rows.push(splitRow(at(i)));
        i += 1;
      }
      blocks.push({ kind: "table", head, rows, align });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered && !bullet);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const match = isOrdered ? ORDERED.exec(at(i)) : BULLET.exec(at(i));
        if (!match) break;
        const indent = (match[1] ?? "").replace(/\t/g, "  ").length;
        const text = match[2] ?? "";
        const previous = items[items.length - 1];
        if (indent >= 2 && previous) previous.children.push(text);
        else items.push({ text, children: [] });
        i += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    // Paragraph: everything up to the next blank line or block opener.
    const paragraph: string[] = [];
    while (i < lines.length && at(i).trim() !== "" && !isBlockStart(at(i))) {
      paragraph.push(at(i).replace(/\s{2,}$/, ""));
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

function isBlockStart(line: string) {
  return (
    HEADING.test(line) ||
    FENCE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    line.startsWith(">") ||
    /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
  );
}

function splitRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i] ?? "";
    if (char === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

/** Section headings, for a table of contents beside the document. */
export function outline(markdown: string, levels = [2]): Outline[] {
  return parseBlocks(markdown)
    .filter((block): block is Extract<Block, { kind: "heading" }> => block.kind === "heading")
    .filter((block) => levels.includes(block.level))
    .map((block) => ({ text: block.text, slug: slugify(block.text), level: block.level }));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Rough word count for the document header, ignoring code blocks and tables. */
export function wordCount(markdown: string): number {
  return parseBlocks(markdown)
    .map((block) => {
      switch (block.kind) {
        case "paragraph":
        case "heading":
          return block.text;
        case "list":
          return block.items.map((item) => `${item.text} ${item.children.join(" ")}`).join(" ");
        case "quote":
          return block.lines.join(" ");
        default:
          return "";
      }
    })
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

type RenderOptions = {
  /** Rewrite a document-relative asset path into something this page can load. */
  resolveSrc?: (src: string) => string;
};

export function MarkdownDoc({
  markdown,
  options = {},
}: {
  markdown: string;
  options?: RenderOptions;
}) {
  const blocks = parseBlocks(markdown);
  let figure = 0;
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "figure") figure += 1;
        return <BlockView key={index} block={block} options={options} figureNumber={figure} />;
      })}
    </>
  );
}

function BlockView({
  block,
  options,
  figureNumber,
}: {
  block: Block;
  options: RenderOptions;
  figureNumber: number;
}) {
  switch (block.kind) {
    case "heading": {
      // h1 is the document title; h2 opens a section in mono; h3 is a plain label.
      if (block.level === 1) {
        return (
          <h1
            id={slugify(block.text)}
            className="m-0 font-display text-[clamp(38px,5.4vw,64px)] font-normal leading-[1.02] tracking-[-.02em]"
          >
            {renderInline(block.text, options)}
          </h1>
        );
      }
      if (block.level === 2) {
        return (
          <h2
            id={slugify(block.text)}
            className="m-0 scroll-mt-28 pt-4 font-mono text-[13px] uppercase tracking-[.2em] text-accent"
          >
            {renderInline(block.text, options)}
          </h2>
        );
      }
      return (
        <h3 id={slugify(block.text)} className="m-0 scroll-mt-28 text-[17px] font-semibold text-fg">
          {renderInline(block.text, options)}
        </h3>
      );
    }

    case "paragraph":
      return (
        <p className="m-0 max-w-[70ch] text-[16.5px] leading-[1.75] text-fg-soft">
          {renderInline(block.text, options)}
        </p>
      );

    case "quote":
      return (
        <blockquote className="m-0 flex flex-col gap-2 border-l border-accent/40 py-1 pl-5">
          {block.lines
            .filter((line) => line.trim() !== "")
            .map((line, index) => (
              <span key={index} className="max-w-[64ch] text-[15px] leading-[1.7] text-fg-muted">
                {renderInline(line, options)}
              </span>
            ))}
        </blockquote>
      );

    case "code":
      return (
        <pre className="dm-well m-0 overflow-auto p-[22px] text-[13px] leading-[1.9] text-[#B8C0C8]">
          {block.lang ? (
            <span className="mb-2 block font-mono text-[10.5px] uppercase tracking-label text-fg-faint">
              {block.lang}
            </span>
          ) : null}
          <code>{block.code}</code>
        </pre>
      );

    case "rule":
      return <hr className="m-0 h-px w-full border-0 bg-line" />;

    case "list":
      return block.ordered ? (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-3 text-[15.5px] leading-[1.7] text-fg-soft">
              <span className="shrink-0 font-mono text-[12px] text-fg-faint">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0">
                {renderInline(item.text, options)}
                <NestedItems items={item.children} options={options} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-3 text-[15.5px] leading-[1.7] text-fg-soft">
              <span aria-hidden className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-accent/60" />
              <span className="min-w-0">
                {renderInline(item.text, options)}
                <NestedItems items={item.children} options={options} />
              </span>
            </li>
          ))}
        </ul>
      );

    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th
                    key={index}
                    style={{ textAlign: block.align[index] ?? "left" }}
                    className="whitespace-nowrap border-b border-line px-3 py-2.5 font-mono text-[11px] uppercase tracking-label text-fg-faint"
                  >
                    {renderInline(cell, options)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      style={{ textAlign: block.align[cellIndex] ?? "left" }}
                      className="border-b border-white/[.05] px-3 py-2.5 align-top leading-[1.6] text-fg-muted"
                    >
                      {renderInline(cell, options)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "figure": {
      const src = options.resolveSrc ? options.resolveSrc(block.src) : block.src;
      const media = (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={block.alt}
          className="block w-full rounded-sm border border-line bg-ink-900 object-cover"
        />
      );
      return (
        <figure className="m-0 flex flex-col gap-2.5">
          {block.href ? (
            <a
              href={options.resolveSrc ? options.resolveSrc(block.href) : block.href}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              {media}
            </a>
          ) : (
            media
          )}
          <figcaption className="font-mono text-[11px] text-fg-faint">
            Fig. {figureNumber}
            {block.alt ? ` — ${block.alt}` : ""}
          </figcaption>
        </figure>
      );
    }
  }
}

function NestedItems({ items, options }: { items: string[]; options: RenderOptions }) {
  if (items.length === 0) return null;
  return (
    <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5 text-[13.5px] leading-[1.65] text-fg-muted">
          <span aria-hidden className="mt-[9px] h-px w-2 shrink-0 bg-white/20" />
          <span className="min-w-0">{renderInline(item, options)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Inline runs, resolved in precedence order: code spans first (nothing nests
 * inside them), then images and links, then strong, then emphasis.
 */
export function renderInline(text: string, options: RenderOptions = {}): ReactNode[] {
  return splitCode(text, options);
}

function splitCode(text: string, options: RenderOptions): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(...splitLinks(text.slice(last, match.index), options, `c${key}`));
    out.push(
      <code
        key={`code-${key++}`}
        className="rounded-[5px] bg-accent/[.08] px-1.5 py-px font-mono text-[.88em] text-accent"
      >
        {match[1]}
      </code>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(...splitLinks(text.slice(last), options, `c${key}`));
  return out;
}

function splitLinks(text: string, options: RenderOptions, prefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(...splitEmphasis(text.slice(last, match.index), `${prefix}l${key}`));
    const bang = match[1];
    const label = match[2] ?? "";
    const href = match[3] ?? "";
    const resolved = options.resolveSrc ? options.resolveSrc(href) : href;
    if (bang) {
      out.push(
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${prefix}img-${key++}`}
          src={resolved}
          alt={label}
          className="my-2 block w-full rounded-sm border border-line"
        />,
      );
    } else {
      out.push(
        <a
          key={`${prefix}a-${key++}`}
          href={resolved}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline decoration-accent/30 underline-offset-2 transition-colors duration-micro hover:text-accent-bright"
        >
          {splitEmphasis(label, `${prefix}al${key}`)}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(...splitEmphasis(text.slice(last), `${prefix}l${key}`));
  return out;
}

function splitEmphasis(text: string, prefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(unescape(text.slice(last, match.index)));
    if (match[2] !== undefined) {
      out.push(
        <strong key={`${prefix}b-${key++}`} className="font-semibold text-fg">
          {unescape(match[2] ?? "")}
        </strong>,
      );
    } else {
      out.push(
        <em key={`${prefix}i-${key++}`} className="italic">
          {unescape(match[4] ?? "")}
        </em>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(unescape(text.slice(last)));
  return out;
}

/** Undo the renderer's backslash escapes now that the markers have been read. */
function unescape(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1");
}
