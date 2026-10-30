"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The one persistent chrome in the product: a glass bar over the scroll, the
 * wordmark, and the three surfaces of a run.
 *
 * The tabs are derived from the path rather than passed down, because the run
 * they belong to is already in the URL — a run page is `/run/<id>`, its package
 * is `/run/<id>/outputs`, and off a run there is only the overview to show.
 */
export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const runId = pathname.match(/^\/run\/([^/]+)/)?.[1];
  const onOutputs = Boolean(runId) && pathname.endsWith("/outputs");
  const onDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  const tabs: Array<{
    label: string;
    href: string;
    active: boolean;
    testId: string;
  }> = [
    {
      label: "overview",
      href: "/",
      active: pathname === "/",
      testId: "nav-overview",
    },
    {
      label: "dashboard",
      href: "/dashboard",
      active: onDashboard,
      testId: "nav-dashboard",
    },
  ];
  if (runId) {
    tabs.push(
      {
        label: "live run",
        href: `/run/${runId}`,
        active: !onOutputs && !onDashboard,
        testId: "nav-live-run",
      },
      {
        label: "case package",
        href: `/run/${runId}/outputs`,
        active: onOutputs,
        testId: "nav-case-package",
      },
    );
  }

  return (
    <nav className="dm-glass sticky top-0 z-50 flex flex-wrap items-center gap-4 border-x-0 border-t-0 px-5 py-3.5 sm:px-7">
      <Link href="/" className="flex items-center gap-2.5 text-fg no-underline">
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-full bg-accent"
          style={{ animation: "dmPulse 3.4s ease-in-out infinite" }}
        />
        <span className="font-display text-[21px] leading-none tracking-[-0.01em]">DoceoMenter</span>
        <span className="hidden sm:inline-block rounded-pill border border-white/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
          Ops
        </span>
      </Link>

      <div className="ml-auto flex max-w-full overflow-x-auto rounded-pill border border-white/10 bg-ink-900/40 p-1 backdrop-blur-md gap-1">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            data-testid={tab.testId}
            aria-current={tab.active ? "page" : undefined}
            className={`flex h-8 items-center rounded-pill px-4 font-mono text-[13px] tracking-[0.04em] no-underline duration-control ease-house shrink-0 ${
              tab.active
                ? "bg-accent/10 text-accent border border-accent/20 font-medium"
                : "text-fg-muted hover:text-fg border border-transparent hover:bg-white/[0.04] transition-[background,color]"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
