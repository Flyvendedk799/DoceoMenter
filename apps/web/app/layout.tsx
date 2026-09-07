import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "../components/SiteNav";

export const metadata: Metadata = {
  title: "DoceoMenter — A repository URL in, a documented case out",
  description:
    "Turn a GitHub URL into a Markdown report, HTML deck, and PDF — with real screenshots and short videos of the project running.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          The system's two voices are web fonts, but nothing depends on them: the
          stacks in `globals.css` fall back to Georgia and the platform mono, so a
          build with no network out still renders the same layout.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist+Mono:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen overflow-x-hidden bg-ink-900 text-fg antialiased">
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
