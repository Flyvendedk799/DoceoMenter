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
 * Which of the six ways of paying this run should use.
 *
 * The panel shows all six whether or not they are configured, because the interesting fact
 * about a provider is usually *why* it is unavailable — a Claude plan that needs connecting
 * and an OpenAI key that was never pasted are one click and one paste away respectively, and a
 * picker that hides them just leaves someone wondering where the option went.
 */
export function ProviderPanel({
  value,
  onChange,
  onSummary,
}: {
  value: ProviderChoice;
  onChange: (choice: ProviderChoice) => void;
  /** One line about the selected credential, for a collapsed parent to display. */
  onSummary?: (summary: string) => void;
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

  const selected = status?.providers?.find((p) => p.id === value.provider);

  // The chooser display falls back to `selected.defaultModel` when `value.model` is missing,
  // which previously meant the UI could show Gemini 3.1 Pro while the POST omitted `model`
  // and the worker used a stale env primary/fallback (e.g. gemini-1.5-flash). Pin the model
  // into the preference whenever the panel knows which provider is selected.
  useEffect(() => {
    if (!selected) return;
    const modelOk = Boolean(value.model && selected.models.some((m) => m.id === value.model));
    if (modelOk) return;
    chosen.current = true;
    const next = { provider: value.provider, model: selected.defaultModel };
    onChange(next);
    window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify(next));
  }, [selected, value.model, value.provider, onChange]);

  // Report the selected credential upward so a collapsed disclosure can say what will be
  // charged without opening. Kept in a ref: the parent passes a setState and re-renders on
  // every keystroke, and this should follow the status, not the typing.
  const summaryRef = useRef(onSummary);
  summaryRef.current = onSummary;
  useEffect(() => {
    if (!summaryRef.current) return;
    if (error) summaryRef.current("provider status unavailable");
    else if (!status) summaryRef.current("checking credentials…");
    else if (!selected) summaryRef.current("no provider selected");
    else if (selected.ready) summaryRef.current(`${selected.label.toLowerCase()} · ${selected.source}`);
    else summaryRef.current(`${selected.label.toLowerCase()} · not configured`);
  }, [error, status, selected]);

  return (
    <section className="dm-card dm-card-active p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="m-0 text-[15px] font-semibold">How this run gets paid for</h3>
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-[1.65] text-fg-muted">
            Sign in with your own Claude plan and the run bills your account rather than this
            server. An API key works too — it is encrypted here, shown only as a mask, and never
            readable back out.
          </p>
        </div>
        {selected && (
          <span
            className={`dm-pill shrink-0 ${
              selected.ready
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-white/10 bg-white/[.04] text-fg-faint"
            }`}
          >
            {selected.ready ? `Ready · ${selected.source}` : "Not configured"}
          </span>
        )}
      </div>

      {status && !status.available && <Notice tone="warn">{status.reason ?? "Credentials cannot be stored on this deployment."}</Notice>}
      {status?.ephemeralSecret && (
        <Notice tone="warn">
          No <code className="font-mono">DOCEOMENTER_SECRET_KEY</code> is set, so credentials are
          encrypted with a key that only exists while this process does — anything connected now
          reads as disconnected after a restart.
        </Notice>
      )}
      {error && <Notice tone="fail">{error}</Notice>}

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {(status?.providers ?? []).map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => {
              const keep =
                value.provider === provider.id &&
                value.model &&
                provider.models.some((m) => m.id === value.model)
                  ? value.model
                  : provider.defaultModel;
              select({ provider: provider.id as AiProvider, model: keep });
            }}
            aria-pressed={value.provider === provider.id}
            className={`rounded-sm border px-3.5 py-3 text-left transition-[border-color,background] duration-control ease-house ${
              value.provider === provider.id
                ? "border-accent/50 bg-accent/[.08]"
                : "border-line bg-ink-900 hover:border-white/20"
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-semibold text-fg">{provider.label}</span>
              <span
                className={`shrink-0 whitespace-nowrap rounded-pill px-2 py-0.5 font-mono text-[10px] uppercase tracking-[.1em] ${
                  provider.ready ? "bg-accent/15 text-accent" : "bg-white/[.06] text-fg-faint"
                }`}
              >
                {provider.ready ? provider.source : "not set up"}
              </span>
            </span>
            <span className="mt-1.5 block text-[12.5px] leading-[1.55] text-fg-muted">{provider.blurb}</span>
            {provider.plan && (
              <span className="mt-1.5 block font-mono text-[11px] text-accent">
                plan: {provider.plan}
                {provider.expired ? " · token expired, refreshes on next use" : ""}
              </span>
            )}
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-4">
          {selected.id === "claude-code" && <ClaudeTerminal onChange={() => void refresh()} />}

          {selected.id === "codex" && (
            <CodexNote status={selected} localCliEnabled={status?.localCliEnabled ?? false} />
          )}

          {selected.id === "gemini-cli" && (
            <GeminiConnect
              status={selected}
              localCliEnabled={status?.localCliEnabled ?? false}
              onRefresh={() => void refresh()}
            />
          )}

          {selected.kind === "key" && <KeyField provider={selected} onSaved={(next) => setStatus(next)} />}

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

/** Amber is the degraded gate, red is a blocking fault — the only two non-cyan signals. */
function Notice({ tone, children }: { tone: "warn" | "fail"; children: React.ReactNode }) {
  const palette =
    tone === "warn"
      ? "border-warn/30 bg-warn/[.07] text-[#D8C9A6]"
      : "border-fail/30 bg-fail/[.08] text-fail";
  return (
    <p className={`mt-3 rounded-sm border px-3.5 py-2.5 text-[13px] leading-[1.6] ${palette}`}>{children}</p>
  );
}

function CodexNote({ status, localCliEnabled }: { status: ProviderStatus; localCliEnabled: boolean }) {
  return (
    <p className="dm-well rounded-sm px-3.5 py-3 text-[12.5px] leading-[1.65] text-fg-muted">
      {!localCliEnabled
        ? "Machine logins are disabled on this deployment (ALLOW_LOCAL_CLI=false), so Codex is unavailable here."
        : status.ready
          ? "Using the `codex` login already on the machine hosting DoceoMenter. Nothing is stored here — the credential is re-read each time, and the CLI keeps it current."
          : "No `codex` login found on the machine hosting DoceoMenter. Run `codex` there and sign in with your ChatGPT account, then reload this page."}
    </p>
  );
}

/**
 * Antigravity for a personal Google AI subscription — machine login first (like Claude Code),
 * optional panel Connect second. There is no library terminal component the way Claude has
 * `ClaudeTerminal`, so the same three steps (start, show URL, paste code) are built here
 * against `/api/gemini/*`. Internal provider id remains `gemini-cli` for the registry.
 */
function GeminiConnect({
  status,
  localCliEnabled,
  onRefresh,
}: {
  status: ProviderStatus;
  localCliEnabled: boolean;
  /** `/api/gemini/*` returns its own account status, not a full `AuthStatus` — re-fetch instead of setting it directly. */
  onRefresh: () => void;
}) {
  const [loginUrl, setLoginUrl] = useState<string | undefined>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();

  async function start() {
    setBusy(true);
    setNote(undefined);
    try {
      // Always G1 / personal Google AI client — the prod Antigravity client does not expose
      // gemini-3.1-pro for personal accounts (404 "does not know a model").
      const response = await fetch("/api/gemini/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isDogfood: true }),
      });
      const body = (await response.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!response.ok || !body.url) throw new Error(body.message ?? `HTTP ${response.status}`);
      setLoginUrl(body.url);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    setNote(undefined);
    try {
      const response = await fetch("/api/gemini/login/complete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
      onRefresh();
      setLoginUrl(undefined);
      setCode("");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const response = await fetch("/api/gemini", { method: "DELETE", credentials: "same-origin" });
      if (response.ok) onRefresh();
    } finally {
      setBusy(false);
    }
  }

  const awaitingCode = (
    <div className="space-y-2">
      <p className="text-[12.5px] leading-[1.6] text-fg-muted">
        Open this URL, approve, and paste back the code it shows:
      </p>
      <a
        href={loginUrl}
        target="_blank"
        rel="noreferrer"
        className="block break-all rounded-sm border border-line bg-ink-900 px-3 py-2 font-mono text-[11px] text-accent"
      >
        {loginUrl}
      </a>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="4/0A..."
          className="dm-input h-11 min-w-0 flex-1 font-mono text-[13px]"
        />
        <button
          type="button"
          disabled={busy || !code.trim()}
          onClick={() => void complete()}
          className="dm-btn h-11 px-5 text-[13px]"
        >
          Connect Antigravity
        </button>
      </div>
    </div>
  );

  if (status.source === "connected account") {
    return (
      <div className="space-y-2">
        <p className="dm-well rounded-sm px-3.5 py-3 text-[12.5px] leading-[1.65] text-fg-muted">
          Antigravity signed in as <span className="text-fg">{status.plan}</span> — same idea as
          Claude Code&apos;s panel login. Runs bill this Google AI account, not the server&apos;s
          machine login.
        </p>
        <button type="button" disabled={busy} onClick={() => void disconnect()} className="dm-btn-secondary h-10 px-4 text-[13px]">
          Disconnect
        </button>
        <ProjectIdField status={status} onRefresh={onRefresh} />
        {note && <p className="font-mono text-[11px] text-fg-faint">{note}</p>}
      </div>
    );
  }

  if (status.source === "machine login") {
    return (
      <div className="space-y-4">
        <p className="dm-well rounded-sm px-3.5 py-3 text-[12.5px] leading-[1.65] text-fg-muted">
          No browser session — using the Antigravity (<span className="text-fg">agy</span>) login on
          this machine (signed in as {status.plan}). For normal use, open DoceoMenter in a browser
          and Connect Antigravity below so your own Google AI account pays.
        </p>

        <div className="space-y-2 pt-2 border-t border-line">
          {!loginUrl ? (
            <div className="flex flex-col gap-2">
              <p className="text-[12.5px] leading-[1.6] text-fg-muted">
                Signs in with the personal Google AI / G1 client (required for{" "}
                <span className="text-fg">gemini-3.1-pro</span>).
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void start()}
                className="dm-btn h-11 px-5 text-[13px] self-start"
              >
                Connect Antigravity in browser
              </button>
            </div>
          ) : (
            awaitingCode
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!loginUrl ? (
        <div className="flex flex-col gap-2">
          <p className="dm-well rounded-sm px-3.5 py-3 text-[12.5px] leading-[1.65] text-fg-muted">
            Sign in with the personal Google AI account that should pay for this run — same flow as
            Claude Code in the panel (G1 / personal client). Disconnect and reconnect if you
            connected before this fix. Enterprise/team licenses are not supported.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void start()}
            className="dm-btn h-11 px-5 text-[13px] self-start"
          >
            Connect Antigravity
          </button>
        </div>
      ) : (
        awaitingCode
      )}
      {note && <p className="font-mono text-[11px] text-fg-faint">{note}</p>}
    </div>
  );
}

/**
 * Optional override — `agy` discovers a managed project after Google login; leave blank.
 * Only set this if discovery logged that Google expects a user-owned GCP project and Connect
 * alone still fails. Never set Google's enterprise shared project `aicode-consumers`.
 */
function ProjectIdField({ status, onRefresh }: { status: ProviderStatus; onRefresh: () => void }) {
  const [value, setValue] = useState(status.projectId ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();

  async function save() {
    setBusy(true);
    setNote(undefined);
    try {
      const response = await fetch("/api/gemini", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: value.trim() || null }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
      onRefresh();
      setNote("Saved.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="flex flex-col gap-2">
      <span className="font-mono text-[11px] tracking-label text-fg-faint">
        PERSONAL GCP PROJECT{" "}
        <span className="normal-case tracking-normal text-fg-faint">(optional escape hatch)</span>
      </span>
      <p className="text-[12.5px] leading-[1.6] text-fg-muted">
        Same as <span className="text-fg">agy</span>: Connect with Google is enough — DoceoMenter
        should discover the managed project automatically. Only fill this in if a run says discovery
        failed and asks for a project you own.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="leave blank — like agy"
          className="dm-input h-11 min-w-0 flex-1 font-mono text-[13px]"
        />
        <button type="button" disabled={busy} onClick={() => void save()} className="dm-btn-secondary h-11 px-5 text-[13px]">
          Save
        </button>
      </div>
      {note && <span className="font-mono text-[11px] text-fg-faint">{note}</span>}
    </label>
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
        <span className="font-mono text-[11px] tracking-label text-fg-faint">
          {provider.label.toUpperCase()}
          {provider.hint && (
            <span className="ml-2 normal-case tracking-normal text-fg-faint">
              {provider.source === "environment" ? `${provider.hint} (from the server env)` : provider.hint}
            </span>
          )}
        </span>
        <div className="flex flex-wrap gap-2">
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              provider.wire === "openai" ? "sk-..." : provider.wire === "gemini" ? "AIza..." : "sk-ant-..."
            }
            className="dm-input h-11 min-w-0 flex-1 text-[13px]"
          />
          <button
            type="button"
            disabled={busy || key.trim().length === 0}
            onClick={() => void save(key.trim())}
            className="dm-btn h-11 px-5 text-[13px]"
          >
            Save
          </button>
          {provider.source === "stored key" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(null)}
              className="dm-btn-secondary h-11 px-5 text-[13px]"
            >
              Remove
            </button>
          )}
        </div>
      </label>
      {note && <p className="font-mono text-[11px] text-fg-faint">{note}</p>}
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
      <span className="font-mono text-[11px] tracking-label text-fg-faint">MODEL</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="dm-input h-11 cursor-pointer text-[13px]"
      >
        {provider.models.map((model) => (
          <option key={model.id} value={model.id} className="bg-ink-800 text-fg">
            {model.label} · {model.tier}
          </option>
        ))}
      </select>
      {current && <span className="text-[12.5px] leading-[1.6] text-fg-muted">{current.note}</span>}
    </label>
  );
}
