"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClaudeTerminal, setClaudeApiPrefix } from "@flyvendedk799/ai-auth/react";
import "@flyvendedk799/ai-auth/react/terminal.css";
import type { AuthStatus, ProviderStatus } from "@doceomenter/auth";
import type { AiProvider } from "@doceomenter/shared";

// The routes are mounted at Next's own path, which happens to be the library's default. Set
// explicitly anyway: the two agreeing by coincidence is how a namespaced API breaks the login.
setClaudeApiPrefix("/api/claude-code");

const PREFERENCE_KEY = "doceomenter.provider";

export type ProviderChoice = { provider: AiProvider; model?: string };

/**
 * Which of the four ways of paying this run should use.
 *
 * The panel shows all four whether or not they are configured, because the interesting fact
 * about a provider is usually *why* it is unavailable — a Claude plan that needs connecting
 * and an OpenAI key that was never pasted are one click and one paste away respectively, and a
 * picker that hides them just leaves someone wondering where the option went.
 */
export function ProviderPanel({
  value,
  onChange,
}: {
  value: ProviderChoice;
  onChange: (choice: ProviderChoice) => void;
}) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | undefined>();
  /** Set as soon as a preference is restored or a card is clicked, so nothing overrides a choice. */
  const chosen = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/providers", { credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = (await response.json()) as AuthStatus;
      setStatus(next);
      setError(undefined);

      // Land on something that would actually work. Opening on a provider with no credential
      // means the first click on Generate fails, and the failure is the app's fault, not the
      // user's — they never chose anything.
      if (!chosen.current) {
        const ready = next.providers.find((provider) => provider.ready);
        if (ready) onChange({ provider: ready.id as AiProvider, model: ready.defaultModel });
      }
    } catch (e) {
      setError(`Could not read provider status: ${(e as Error).message}`);
    }
    // `onChange` is a setState function from the parent and stable in practice; listing it
    // would re-run the fetch on every render of the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The chosen provider is a preference, not a secret, so the browser is the right place for
  // it. Everything that could spend money now lives on the server.
  useEffect(() => {
    const saved = window.localStorage.getItem(PREFERENCE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ProviderChoice;
        if (parsed.provider) {
          chosen.current = true;
          onChange(parsed);
        }
      } catch {
        window.localStorage.removeItem(PREFERENCE_KEY);
      }
    }
    // Runs once: this restores a preference, it does not track later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (choice: ProviderChoice) => {
    chosen.current = true;
    onChange(choice);
    window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify(choice));
  };

  const selected = status?.providers.find((p) => p.id === value.provider);

  return (
    <section className="rounded-md border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
            How this run gets paid for
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-emerald-900/75 dark:text-emerald-200/75">
            Sign in with your own Claude plan and the run bills your account rather than this
            server. An API key works too — it is encrypted here, shown only as a mask, and never
            readable back out.
          </p>
        </div>
        {selected && (
          <span className="whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 shadow-sm dark:bg-emerald-500/10 dark:text-emerald-200">
            {selected.ready ? `Ready · ${selected.source}` : "Not configured"}
          </span>
        )}
      </div>

      {status && !status.available && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
          {status.reason ?? "Credentials cannot be stored on this deployment."}
        </p>
      )}
      {status?.ephemeralSecret && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
          No <code>DOCEOMENTER_SECRET_KEY</code> is set, so credentials are encrypted with a key
          that only exists while this process does — anything connected now reads as disconnected
          after a restart.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(status?.providers ?? []).map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => select({ provider: provider.id as AiProvider, model: provider.defaultModel })}
            aria-pressed={value.provider === provider.id}
            className={`rounded-md border px-3 py-3 text-left transition ${
              value.provider === provider.id
                ? "border-emerald-500 bg-white text-emerald-950 shadow-sm dark:border-emerald-400 dark:bg-emerald-500/10 dark:text-emerald-100"
                : "border-emerald-200/80 bg-white/60 text-zinc-800 hover:border-emerald-300 dark:border-emerald-900 dark:bg-zinc-950/40 dark:text-zinc-200"
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{provider.label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  provider.ready
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                    : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {provider.ready ? provider.source : "not set up"}
              </span>
            </span>
            <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{provider.blurb}</span>
            {provider.plan && (
              <span className="mt-1 block text-xs text-emerald-700 dark:text-emerald-300">
                plan: {provider.plan}
                {provider.expired ? " · token expired, refreshes on next use" : ""}
              </span>
            )}
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-4">
          {selected.id === "claude-code" && (
            <ClaudeTerminal onChange={() => void refresh()} />
          )}

          {selected.id === "codex" && <CodexNote status={selected} localCliEnabled={status?.localCliEnabled ?? false} />}

          {selected.kind === "key" && (
            <KeyField provider={selected} onSaved={(next) => setStatus(next)} />
          )}

          <ModelPicker
            provider={selected}
            value={value.model ?? selected.defaultModel}
            onChange={(model) => select({ provider: value.provider, model })}
          />
        </div>
      )}
    </section>
  );
}

function CodexNote({ status, localCliEnabled }: { status: ProviderStatus; localCliEnabled: boolean }) {
  return (
    <p className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      {!localCliEnabled
        ? "Machine logins are disabled on this deployment (ALLOW_LOCAL_CLI=false), so Codex is unavailable here."
        : status.ready
          ? "Using the `codex` login already on the machine hosting DoceoMenter. Nothing is stored here — the credential is re-read each time, and the CLI keeps it current."
          : "No `codex` login found on the machine hosting DoceoMenter. Run `codex` there and sign in with your ChatGPT account, then reload this page."}
    </p>
  );
}

/**
 * Paste a key, or clear one.
 *
 * The field starts empty even when a key is stored, and the mask beside it is the only thing
 * the server will say about it. That is not a UI decision — there is no route that returns a
 * stored key, so there is nothing to prefill with.
 */
function KeyField({
  provider,
  onSaved,
}: {
  provider: ProviderStatus;
  onSaved: (status: AuthStatus) => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();

  async function save(next: string | null) {
    setBusy(true);
    setNote(undefined);
    try {
      const response = await fetch("/api/providers", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: provider.id, key: next }),
      });
      const body = (await response.json().catch(() => ({}))) as AuthStatus & { message?: string };
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
      onSaved(body);
      setKey("");
      setNote(next ? "Saved." : "Removed.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {provider.label}
          {provider.hint && (
            <span className="ml-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {provider.source === "environment" ? `${provider.hint} (from the server env)` : provider.hint}
            </span>
          )}
        </span>
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={provider.wire === "openai" ? "sk-..." : "sk-ant-..."}
            className="h-10 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 font-mono text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={busy || key.trim().length === 0}
            onClick={() => void save(key.trim())}
            className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            Save
          </button>
          {provider.source === "stored key" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(null)}
              className="h-10 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
            >
              Remove
            </button>
          )}
        </div>
      </label>
      {note && <p className="text-xs text-zinc-500 dark:text-zinc-400">{note}</p>}
    </div>
  );
}

/**
 * The model, with its weight.
 *
 * A plan meters each model on its own allowance, so when the heavy one is refused the fix is
 * to pick a lighter one — and a list of bare names cannot help anyone do that. The tier comes
 * from the same registry the error messages do.
 */
function ModelPicker({
  provider,
  value,
  onChange,
}: {
  provider: ProviderStatus;
  value: string;
  onChange: (model: string) => void;
}) {
  const current = provider.models.find((m) => m.id === value);
  return (
    <label className="mt-3 flex flex-col gap-2">
      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Model</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900"
      >
        {provider.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label} · {model.tier}
          </option>
        ))}
      </select>
      {current && <span className="text-xs text-zinc-500 dark:text-zinc-400">{current.note}</span>}
    </label>
  );
}
