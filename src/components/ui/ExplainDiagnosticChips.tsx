import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CircleSlash,
  DatabaseZap,
  Filter,
  Flame,
  HardDrive,
  Info,
  Layers,
  Repeat,
  ScanSearch,
  TrendingDown,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import type {
  ExplainDiagnostic,
  ExplainDiagnosticKind,
  ExplainDiagnosticSeverity,
} from "../../utils/explainDiagnostics";

const KIND_ICONS: Record<ExplainDiagnosticKind, LucideIcon> = {
  hotspot: Flame,
  "over-estimate": TrendingUp,
  "under-estimate": TrendingDown,
  "disk-sort": HardDrive,
  "filter-loss": Filter,
  "large-seq-scan": ScanSearch,
  "heap-fetches": Layers,
  "workers-underused": Users,
  "high-loops": Repeat,
  "cache-miss": DatabaseZap,
  "never-executed": CircleSlash,
};

const SEVERITY_ICONS: Record<ExplainDiagnosticSeverity, LucideIcon> = {
  critical: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
};

function severityChipClass(severity: ExplainDiagnosticSeverity): string {
  switch (severity) {
    case "critical":
      return "border-red-500/40 bg-red-950/30 text-red-200";
    case "warning":
      return "border-amber-500/40 bg-amber-950/30 text-amber-200";
    case "info":
      return "border-default bg-surface-secondary/40 text-secondary";
  }
}

function severityTextClass(severity: ExplainDiagnosticSeverity): string {
  switch (severity) {
    case "critical":
      return "text-red-300";
    case "warning":
      return "text-amber-300";
    case "info":
      return "text-secondary";
  }
}

interface ExplainDiagnosticChipsProps {
  diagnostics: ExplainDiagnostic[];
  /** Show icons only, for dense contexts such as table rows. */
  iconsOnly?: boolean;
  className?: string;
}

/** Compact severity chips, one per finding on a node. */
export function ExplainDiagnosticChips({
  diagnostics,
  iconsOnly = false,
  className,
}: ExplainDiagnosticChipsProps) {
  const { t } = useTranslation();

  if (diagnostics.length === 0) {
    return null;
  }

  return (
    <div className={clsx("flex flex-wrap items-center gap-1", className)}>
      {diagnostics.map((diagnostic) => {
        const Icon = KIND_ICONS[diagnostic.kind];
        const label = t(diagnostic.labelKey);

        return (
          <span
            key={diagnostic.kind}
            title={`${label}${diagnostic.value ? ` (${diagnostic.value})` : ""} — ${t(diagnostic.descriptionKey)}`}
            className={clsx(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-none",
              severityChipClass(diagnostic.severity),
            )}
          >
            <Icon size={10} className="shrink-0" />
            {!iconsOnly && <span className="font-medium">{label}</span>}
            {diagnostic.value && (
              <span className="font-mono opacity-90">{diagnostic.value}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

interface ExplainDiagnosticListProps {
  diagnostics: ExplainDiagnostic[];
}

/** Findings with their explanation, for the node details panel. */
export function ExplainDiagnosticList({
  diagnostics,
}: ExplainDiagnosticListProps) {
  const { t } = useTranslation();

  if (diagnostics.length === 0) {
    return null;
  }

  return (
    <div className="divide-y divide-default/40">
      {diagnostics.map((diagnostic) => {
        const Icon = SEVERITY_ICONS[diagnostic.severity];

        return (
          <div key={diagnostic.kind} className="flex gap-2 px-4 py-2.5">
            <Icon
              size={13}
              className={clsx("mt-0.5 shrink-0", severityTextClass(diagnostic.severity))}
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span
                  className={clsx(
                    "text-[11px] font-semibold",
                    severityTextClass(diagnostic.severity),
                  )}
                >
                  {t(diagnostic.labelKey)}
                </span>
                {diagnostic.value && (
                  <span className="font-mono text-[11px] text-secondary">
                    {diagnostic.value}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-muted">
                {t(diagnostic.descriptionKey)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
