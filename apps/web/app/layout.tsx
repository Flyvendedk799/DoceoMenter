import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DoceoMenter — Repo to deck, in one click",
  description: "Turn a GitHub URL into a Markdown report, HTML deck, and PDF — with real screenshots and short videos of the project running.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
