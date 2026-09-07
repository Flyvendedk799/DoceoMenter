"use client";

import { useEffect } from "react";

/**
 * Section reveals and the hero's parallax, run from one place.
 *
 * Both effects are opt-in through markup — `.dm-reveal` for a section that
 * should rise into view, `[data-mesh]` for the gradient field behind the hero —
 * so a server component can use them without becoming a client component. The
 * reveal is idempotent: anything already on screen at mount is simply shown,
 * which is also what happens when the observer is unavailable.
 */
export function ScrollChoreography() {
  useEffect(() => {
    const show = (el: HTMLElement, delay = 0) => {
      window.setTimeout(() => el.setAttribute("data-shown", "1"), delay);
    };

    const pending = Array.from(document.querySelectorAll<HTMLElement>(".dm-reveal"));
    let disconnect: (() => void) | undefined;

    if (typeof IntersectionObserver === "undefined") {
      pending.forEach((el) => show(el));
    } else {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry, index) => {
            const el = entry.target as HTMLElement;
            // Elements scrolled past above the fold count as seen; only ones
            // still below it wait for the intersection.
            if (!entry.isIntersecting && entry.boundingClientRect.top > 0) return;
            show(el, index * 80);
            observer.unobserve(el);
          });
        },
        { rootMargin: "0px 0px -12% 0px" },
      );
      pending.forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight) show(el);
        else observer.observe(el);
      });

      disconnect = () => observer.disconnect();
    }

    const mesh = document.querySelector<HTMLElement>("[data-mesh]");
    const onScroll = () => {
      if (!mesh) return;
      const y = window.scrollY || 0;
      mesh.style.transform = `translate3d(0, ${y * 0.22}px, 0) scale(${1 + Math.min(y, 900) / 6000})`;
    };
    if (mesh) window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      disconnect?.();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return null;
}
