"use client";

import React, { useState, useRef, useEffect } from "react";

export interface ArtifactMenuProps {
  runId: string;
  disabled?: boolean;
}

const ARTIFACT_LINKS = [
  { label: "deck.html", filename: "deck.html", desc: "Reveal Presentation" },
  { label: "deck.pdf", filename: "deck.pdf", desc: "Print Presentation" },
  { label: "report.md", filename: "report.md", desc: "Written Report" },
  { label: "case-study.json", filename: "case-study.json", desc: "Portfolio Payload" },
  { label: "quality.json", filename: "quality.json", desc: "Quality Gate Audit" },
] as const;

export function ArtifactMenu({ runId, disabled = false }: ArtifactMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <div className="relative inline-block text-left" ref={containerRef} data-testid="artifact-menu">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
        className="dm-btn-secondary h-8 px-3 text-[12px] font-mono tracking-wider"
      >
        <span>Artifacts</span>
        <span aria-hidden="true" className="ml-1 text-[10px] text-fg-faint">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && !disabled && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 z-50 mt-1.5 w-56 rounded-md border border-line bg-ink-800 p-1.5 shadow-xl backdrop-blur-md"
        >
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-fg-faint border-b border-line mb-1">
            Generated Files
          </div>
          {ARTIFACT_LINKS.map((item) => (
            <a
              key={item.filename}
              role="menuitem"
              href={`/api/runs/${encodeURIComponent(runId)}/files/${item.filename}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="flex flex-col gap-0.5 rounded px-2 py-1.5 text-left text-fg-soft hover:bg-white/[0.06] hover:text-accent transition-colors no-underline"
            >
              <span className="font-mono text-[12px] font-medium text-fg">{item.label}</span>
              <span className="text-[11px] text-fg-muted">{item.desc}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
