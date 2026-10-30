"use client";

import React, { useEffect, useState } from "react";
import type { AuthStatus, ProviderStatus } from "@doceomenter/auth";

export interface ProviderStatusWidgetProps {
  initialStatus?: AuthStatus | null;
}

interface ProviderCardDef {
  key: string;
  name: string;
  description: string;
  providerId?: string;
  isFixture?: boolean;
}

const PROVIDER_DEFINITIONS: ProviderCardDef[] = [
  {
    key: "claude-code",
    name: "Claude Code",
    description: "Subscription sign-in (OAuth)",
    providerId: "claude-code",
  },
  {
    key: "anthropic",
    name: "Anthropic Key",
    description: "Direct API key (metered)",
    providerId: "anthropic",
  },
  {
    key: "codex",
    name: "Codex",
    description: "Local machine login (ChatGPT)",
    providerId: "codex",
  },
  {
    key: "openai",
    name: "OpenAI Key",
    description: "Direct API key (metered)",
    providerId: "openai",
  },
  {
    key: "gemini-cli",
    name: "Antigravity",
    description: "Personal Google AI account",
    providerId: "gemini-cli",
  },
  {
    key: "gemini",
    name: "Gemini Key",
    description: "Direct API key (metered)",
    providerId: "gemini",
  },
  {
    key: "fixtures",
    name: "Deterministic Fixtures",
    description: "Local mock replay (no AI bill)",
    isFixture: true,
  },
];

export function ProviderStatusWidget({ initialStatus = null }: ProviderStatusWidgetProps) {
  const [status, setStatus] = useState<AuthStatus | null>(initialStatus);
  const [loading, setLoading] = useState<boolean>(!initialStatus);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unmounted = false;
    async function fetchProviders() {
      try {
        setLoading(true);
        const res = await fetch("/api/providers", { credentials: "same-origin" });
        if (!res.ok) {
          throw new Error(`Failed to load providers: HTTP ${res.status}`);
        }
        const data = (await res.json()) as AuthStatus;
        if (!unmounted) {
          setStatus(data);
          setError(null);
        }
      } catch (err) {
        if (!unmounted) {
          setError((err as Error).message);
        }
      } finally {
        if (!unmounted) {
          setLoading(false);
        }
      }
    }

    if (!initialStatus) {
      void fetchProviders();
    }
    return () => {
      unmounted = true;
    };
  }, [initialStatus]);

  return (
    <section aria-label="AI Providers Status" data-testid="provider-status-widget">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="dm-eyebrow text-accent block">SYSTEM CREDENTIALS</span>
            <h3 className="m-0 text-[18px] font-semibold text-fg">AI Provider Readiness</h3>
          </div>
          {loading && (
            <span className="font-mono text-[11px] text-fg-faint animate-pulse">
              checking credentials…
            </span>
          )}
          {error && (
            <span className="font-mono text-[11px] text-fail">
              {error}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {PROVIDER_DEFINITIONS.map((def) => {
            const providerInfo: ProviderStatus | undefined = def.providerId
              ? status?.providers?.find((p) => p.id === def.providerId)
              : undefined;

            let badgeText = "Not Configured";
            let badgeClass = "border-white/10 bg-white/[.04] text-fg-faint";
            let subtext = def.description;

            if (def.isFixture) {
              badgeText = "Ready";
              badgeClass = "border-accent/30 bg-accent/10 text-accent font-medium";
              subtext = "Offline replay fallback";
            } else if (providerInfo) {
              if (providerInfo.expired) {
                badgeText = "Expired / Action Needed";
                badgeClass = "border-warn/30 bg-warn/[.08] text-warn font-medium";
                subtext = "Token expired, renewal needed";
              } else if (providerInfo.ready) {
                badgeText = "Ready";
                badgeClass = "border-accent/30 bg-accent/10 text-accent font-medium";
                subtext = providerInfo.source
                  ? `${providerInfo.source}${providerInfo.plan ? ` (${providerInfo.plan})` : ""}`
                  : "Configured";
              } else {
                badgeText = "Not Configured";
                badgeClass = "border-white/10 bg-white/[.04] text-fg-faint";
                subtext = "Not connected";
              }
            }

            return (
              <div
                key={def.key}
                data-testid={`provider-card-${def.key}`}
                className="dm-card flex flex-col justify-between p-3.5 bg-ink-800 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span className="font-mono text-[12px] font-semibold text-fg truncate">
                      {def.name}
                    </span>
                  </div>
                  <span
                    data-testid={`provider-badge-${def.key}`}
                    className={`dm-pill h-5 px-2 text-[9px] uppercase tracking-wider block w-fit truncate ${badgeClass}`}
                  >
                    {badgeText}
                  </span>
                </div>
                <div className="mt-3 border-t border-line pt-2">
                  <span className="block truncate text-[11px] text-fg-muted font-mono" title={subtext}>
                    {subtext}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
