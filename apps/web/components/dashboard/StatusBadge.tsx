import React from "react";

export type RunStatusType = "queued" | "running" | "done" | "partial" | "failed" | "cancelled";

export interface StatusBadgeProps {
  status: RunStatusType | string;
  className?: string;
}

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const normStatus = (status || "").toLowerCase() as RunStatusType;

  let colorClasses = "border-white/10 bg-white/[.04] text-fg-muted";
  let showPulse = false;

  switch (normStatus) {
    case "running":
      colorClasses = "border-accent/40 bg-accent/10 text-accent font-medium";
      showPulse = true;
      break;
    case "done":
      colorClasses = "border-accent/30 bg-accent/[.08] text-accent";
      break;
    case "partial":
      colorClasses = "border-warn/30 bg-warn/[.08] text-warn";
      break;
    case "failed":
      colorClasses = "border-fail/30 bg-fail/[.08] text-fail";
      break;
    case "queued":
      colorClasses = "border-white/10 bg-white/[.04] text-fg-muted";
      break;
    case "cancelled":
      colorClasses = "border-white/10 bg-white/[.02] text-fg-faint";
      break;
    default:
      colorClasses = "border-white/10 bg-white/[.04] text-fg-muted";
      break;
  }

  return (
    <span
      data-testid="status-badge"
      data-status={normStatus}
      className={`dm-pill text-[10.5px] uppercase tracking-[0.14em] ${colorClasses} ${className}`}
    >
      {showPulse && (
        <span
          data-testid="status-pulse-dot"
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse"
          style={{ animation: "dmPulse 2s ease-in-out infinite" }}
        />
      )}
      <span>{normStatus}</span>
    </span>
  );
}
