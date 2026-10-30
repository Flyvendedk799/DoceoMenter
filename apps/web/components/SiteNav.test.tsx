import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteNav } from "./SiteNav";

let currentPathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

function renderNav(pathname: string) {
  currentPathname = pathname;
  return renderToStaticMarkup(<SiteNav />);
}

function getNavLink(html: string, testId: string) {
  const regex = new RegExp(`<a\\s+[^>]*data-testid="${testId}"[^>]*>(.*?)<\\/a>`);
  const match = html.match(regex);
  if (!match) return null;

  const fullTag = match[0];
  const href = fullTag.match(/href="([^"]*)"/)?.[1];
  const className = fullTag.match(/class="([^"]*)"/)?.[1] ?? "";
  const ariaCurrent = fullTag.match(/aria-current="([^"]*)"/)?.[1];
  const label = match[1];

  return {
    fullTag,
    href,
    className,
    ariaCurrent,
    label,
  };
}

describe("SiteNav", () => {
  const activeClass = "bg-accent/10 text-accent border border-accent/20 font-medium";
  const inactiveClass = "text-fg-muted hover:text-fg border border-transparent hover:bg-white/[0.04]";

  describe("Brand section and container structure", () => {
    it("renders the brand section with pulsing cyan dot, wordmark, and Ops pill badge", () => {
      const html = renderNav("/");

      // Brand link to /
      expect(html).toContain('href="/"');
      expect(html).toContain("DoceoMenter");

      // Pulsing cyan dot
      expect(html).toContain("h-2.5 w-2.5 rounded-full bg-accent");
      expect(html).toContain("animation:dmPulse 3.4s ease-in-out infinite");

      // Ops badge
      expect(html).toContain("Ops");
      expect(html).toContain("hidden sm:inline-block rounded-pill border border-white/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-faint");
    });

    it("renders the navigation capsule wrapper with overflow-x-auto to prevent wrapping on mobile", () => {
      const html = renderNav("/");
      expect(html).toContain("overflow-x-auto");
      expect(html).toContain("flex max-w-full overflow-x-auto rounded-pill border border-white/10 bg-ink-900/40 p-1 backdrop-blur-md");
    });
  });

  describe("Route '/' (Overview)", () => {
    it("renders overview as active and dashboard as inactive; run tabs absent", () => {
      const html = renderNav("/");

      const overview = getNavLink(html, "nav-overview");
      expect(overview).not.toBeNull();
      expect(overview?.href).toBe("/");
      expect(overview?.label).toBe("overview");
      expect(overview?.ariaCurrent).toBe("page");
      expect(overview?.className).toContain(activeClass);

      const dashboard = getNavLink(html, "nav-dashboard");
      expect(dashboard).not.toBeNull();
      expect(dashboard?.href).toBe("/dashboard");
      expect(dashboard?.label).toBe("dashboard");
      expect(dashboard?.ariaCurrent).toBeUndefined();
      expect(dashboard?.className).toContain(inactiveClass);

      expect(getNavLink(html, "nav-live-run")).toBeNull();
      expect(getNavLink(html, "nav-case-package")).toBeNull();
    });
  });

  describe("Route '/dashboard' (Dashboard)", () => {
    it("renders dashboard as active and overview as inactive; run tabs absent", () => {
      const html = renderNav("/dashboard");

      const overview = getNavLink(html, "nav-overview");
      expect(overview).not.toBeNull();
      expect(overview?.href).toBe("/");
      expect(overview?.ariaCurrent).toBeUndefined();
      expect(overview?.className).toContain(inactiveClass);

      const dashboard = getNavLink(html, "nav-dashboard");
      expect(dashboard).not.toBeNull();
      expect(dashboard?.href).toBe("/dashboard");
      expect(dashboard?.ariaCurrent).toBe("page");
      expect(dashboard?.className).toContain(activeClass);

      expect(getNavLink(html, "nav-live-run")).toBeNull();
      expect(getNavLink(html, "nav-case-package")).toBeNull();
    });

    it("keeps dashboard active on nested dashboard routes", () => {
      const html = renderNav("/dashboard/runs");

      const dashboard = getNavLink(html, "nav-dashboard");
      expect(dashboard).not.toBeNull();
      expect(dashboard?.ariaCurrent).toBe("page");
      expect(dashboard?.className).toContain(activeClass);

      const overview = getNavLink(html, "nav-overview");
      expect(overview?.ariaCurrent).toBeUndefined();
      expect(overview?.className).toContain(inactiveClass);
    });
  });

  describe("Route '/run/123' (Live Run)", () => {
    it("renders contextual live run as active and case package as inactive alongside overview and dashboard", () => {
      const html = renderNav("/run/123");

      const overview = getNavLink(html, "nav-overview");
      expect(overview).not.toBeNull();
      expect(overview?.href).toBe("/");
      expect(overview?.ariaCurrent).toBeUndefined();
      expect(overview?.className).toContain(inactiveClass);

      const dashboard = getNavLink(html, "nav-dashboard");
      expect(dashboard).not.toBeNull();
      expect(dashboard?.href).toBe("/dashboard");
      expect(dashboard?.ariaCurrent).toBeUndefined();
      expect(dashboard?.className).toContain(inactiveClass);

      const liveRun = getNavLink(html, "nav-live-run");
      expect(liveRun).not.toBeNull();
      expect(liveRun?.href).toBe("/run/123");
      expect(liveRun?.label).toBe("live run");
      expect(liveRun?.ariaCurrent).toBe("page");
      expect(liveRun?.className).toContain(activeClass);

      const casePkg = getNavLink(html, "nav-case-package");
      expect(casePkg).not.toBeNull();
      expect(casePkg?.href).toBe("/run/123/outputs");
      expect(casePkg?.label).toBe("case package");
      expect(casePkg?.ariaCurrent).toBeUndefined();
      expect(casePkg?.className).toContain(inactiveClass);
    });
  });

  describe("Route '/run/123/outputs' (Case Package)", () => {
    it("renders contextual case package as active and live run as inactive alongside overview and dashboard", () => {
      const html = renderNav("/run/123/outputs");

      const overview = getNavLink(html, "nav-overview");
      expect(overview).not.toBeNull();
      expect(overview?.href).toBe("/");
      expect(overview?.ariaCurrent).toBeUndefined();
      expect(overview?.className).toContain(inactiveClass);

      const dashboard = getNavLink(html, "nav-dashboard");
      expect(dashboard).not.toBeNull();
      expect(dashboard?.href).toBe("/dashboard");
      expect(dashboard?.ariaCurrent).toBeUndefined();
      expect(dashboard?.className).toContain(inactiveClass);

      const liveRun = getNavLink(html, "nav-live-run");
      expect(liveRun).not.toBeNull();
      expect(liveRun?.href).toBe("/run/123");
      expect(liveRun?.ariaCurrent).toBeUndefined();
      expect(liveRun?.className).toContain(inactiveClass);

      const casePkg = getNavLink(html, "nav-case-package");
      expect(casePkg).not.toBeNull();
      expect(casePkg?.href).toBe("/run/123/outputs");
      expect(casePkg?.ariaCurrent).toBe("page");
      expect(casePkg?.className).toContain(activeClass);
    });
  });
});
