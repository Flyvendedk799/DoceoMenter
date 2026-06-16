import { UrlForm } from "../components/UrlForm";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <section className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-7 sm:px-6 lg:px-8 lg:py-10">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
                Case production
              </p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
                DoceoMenter
              </h1>
            </div>
            <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-zinc-200 text-center text-xs dark:border-zinc-800">
              <div className="px-3 py-2">
                <div className="font-semibold text-zinc-900 dark:text-zinc-100">Analyze</div>
                <div className="text-zinc-500">repo</div>
              </div>
              <div className="border-x border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <div className="font-semibold text-zinc-900 dark:text-zinc-100">Capture</div>
                <div className="text-zinc-500">media</div>
              </div>
              <div className="px-3 py-2">
                <div className="font-semibold text-zinc-900 dark:text-zinc-100">Export</div>
                <div className="text-zinc-500">case</div>
              </div>
            </div>
          </header>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
            <div className="min-w-0 space-y-5">
              <div className="max-w-3xl">
                <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-300">
                  Convert a GitHub repository into a reference-ready case package with audited narrative, real browser media, quality checks, and exportable portfolio data.
                </p>
              </div>
              <UrlForm />
            </div>

            <aside className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Output contract
                </h2>
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                  Reference grade
                </span>
              </div>
              <dl className="mt-5 space-y-4 text-sm">
                <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
                  <dt className="font-medium text-zinc-900 dark:text-zinc-100">Narrative</dt>
                  <dd className="max-w-[13rem] text-right text-zinc-600 dark:text-zinc-400">
                    Markdown report, technical notes, case brief
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
                  <dt className="font-medium text-zinc-900 dark:text-zinc-100">Media</dt>
                  <dd className="max-w-[13rem] text-right text-zinc-600 dark:text-zinc-400">
                    Screenshots, thumbnails, optional walkthrough video
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="font-medium text-zinc-900 dark:text-zinc-100">Data</dt>
                  <dd className="max-w-[13rem] text-right text-zinc-600 dark:text-zinc-400">
                    Portfolio JSON and quality report
                  </dd>
                </div>
              </dl>
            </aside>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-5 py-6 sm:px-6 md:grid-cols-3 lg:px-8">
        {[
          ["Evidence first", "Claims are backed by repository files, runtime captures, and generated quality checks."],
          ["Browser verified", "Apps are booted and inspected with Playwright before the final case package is rendered."],
          ["Portable export", "Generated JSON is shaped for software case pages, decks, and downstream publishing tools."],
        ].map(([title, copy]) => (
          <article
            key={title}
            className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{copy}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
