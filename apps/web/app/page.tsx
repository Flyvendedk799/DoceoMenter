import { UrlForm } from "../components/UrlForm";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10">
        <h1 className="text-4xl font-semibold tracking-tight">DoceoMenter</h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          Paste a GitHub URL. Get a Markdown report, an HTML deck, and a PDF — with real screenshots and a short video of the project running.
        </p>
      </header>
      <UrlForm />
      <section className="mt-12 text-sm text-zinc-500 dark:text-zinc-500">
        <p>
          Your repo is cloned into a sandboxed worker, analyzed by Claude, booted in a real browser via Playwright, captured, and torn down. Bring your own Anthropic API key, or set <code>ANTHROPIC_API_KEY</code> on the server.
        </p>
      </section>
    </main>
  );
}
