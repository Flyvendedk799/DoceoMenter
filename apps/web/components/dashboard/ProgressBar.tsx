import React from "react";

export interface ProgressBarProps {
  resolved: number;
  total?: number;
  percent?: number;
  showText?: boolean;
  className?: string;
}

export function ProgressBar({
  resolved,
  total = 10,
  percent,
  showText = true,
  className = "",
}: ProgressBarProps) {
  const safeTotal = total > 0 ? total : 10;
  const safeResolved = Math.max(0, resolved);
  const pct =
    typeof percent === "number"
      ? Math.min(100, Math.max(0, Math.round(percent)))
      : Math.min(100, Math.max(0, Math.round((safeResolved / safeTotal) * 100)));

  return (
    <div className={`w-full min-w-[120px] ${className}`} data-testid="progress-bar">
      {showText && (
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-mono leading-none">
          <span className="text-fg-muted">
            {`${safeResolved}/${safeTotal} stages`}
          </span>
          <span className="text-accent">{`${pct}%`}</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]"
      >
        <div
          data-testid="progress-bar-fill"
          className="h-full rounded-full bg-[linear-gradient(90deg,#0E8C99,#5AD8E6)] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
