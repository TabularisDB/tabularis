import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  Clock3,
  Database,
  Layers2,
  Maximize2,
  Minimize2,
  Pencil,
  ScanSearch,
  ShieldAlert,
  X,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useEditorTheme } from "../../hooks/useEditorTheme";
import { loadMonacoTheme } from "../../themes/themeUtils";
import type { ExplainPlan, ExplainPlanSummary } from "@tabularis/explain";
import {
  formatCost,
  formatRatio,
  formatRows,
  formatTime,
  getExplainPlanSummary,
} from "@tabularis/explain";
import type { PendingApproval } from "../../types/ai";
import { QueryKindBadge } from "../settings/ai-activity/QueryKindBadge";
import { VisualExplainView } from "../explain/VisualExplainView";
import type { ExplainViewMode } from "@tabularis/explain/react";
import { isDestructiveApproval } from "../../utils/aiActivity";
import { parseApprovalExplainPlan } from "../../utils/approvalExplain";

interface AiApprovalModalProps {
  approval: PendingApproval;
  onApprove: (editedQuery?: string) => Promise<void> | void;
  onDeny: (reason?: string) => Promise<void> | void;
  onClose: () => void;
}

export function AiApprovalModal({
  approval,
  onApprove,
  onDeny,
  onClose,
}: AiApprovalModalProps) {
  const { t } = useTranslation();
  const editorTheme = useEditorTheme();
  const [editing, setEditing] = useState(false);
  const [editedQuery, setEditedQuery] = useState(approval.query);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<ExplainViewMode>("graph");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [planExpanded, setPlanExpanded] = useState(false);

  // Reset local state if a new pending arrives.
  useEffect(() => {
    setEditedQuery(approval.query);
    setEditing(false);
    setReason("");
    setPlanExpanded(false);
  }, [approval.id, approval.query]);

  // Close the expanded plan overlay with Escape without dismissing the parent modal.
  useEffect(() => {
    if (!planExpanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPlanExpanded(false);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [planExpanded]);

  const explainPlan = useMemo<ExplainPlan | null>(
    () => parseApprovalExplainPlan(approval.explainPlan),
    [approval.explainPlan],
  );

  const planSummary = useMemo(
    () => (explainPlan ? getExplainPlanSummary(explainPlan) : null),
    [explainPlan],
  );

  useEffect(() => {
    if (explainPlan?.root?.id && !selectedNodeId) {
      setSelectedNodeId(explainPlan.root.id);
    }
  }, [explainPlan, selectedNodeId]);

  const destructive = isDestructiveApproval(approval);

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      const final = editing && editedQuery.trim() !== approval.query.trim()
        ? editedQuery
        : undefined;
      await onApprove(final);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeny = async () => {
    setSubmitting(true);
    try {
      await onDeny(reason.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[120] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[860px] max-w-[95vw] max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`p-2 rounded-lg ${
                destructive ? "bg-red-900/30" : "bg-purple-900/30"
              }`}
            >
              <ShieldAlert
                size={20}
                className={destructive ? "text-red-400" : "text-purple-400"}
              />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-primary truncate">
                {/* Unknown kinds are treated as writes, mirroring the
                    fail-closed classification of the backend approval gate. */}
                {t(
                  approval.queryKind === "select"
                    ? "aiApproval.titleRead"
                    : "aiApproval.title",
                )}
              </h2>
              <p className="text-xs text-muted truncate">
                {approval.clientHint
                  ? t("aiApproval.subtitleWithClient", {
                      client: approval.clientHint,
                      connection: approval.connectionName,
                    })
                  : t("aiApproval.subtitle", {
                      connection: approval.connectionName,
                    })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <QueryKindBadge kind={approval.queryKind} />
            <button
              onClick={onClose}
              className="text-secondary hover:text-primary transition-colors"
              aria-label={t("common.close")}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase font-bold text-muted">
                {t("aiApproval.query")}
              </label>
              <button
                onClick={() => setEditing((v) => !v)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-primary hover:bg-surface-tertiary rounded transition-colors"
              >
                <Pencil size={11} />
                {editing
                  ? t("aiApproval.lockQuery")
                  : t("aiApproval.editQuery")}
              </button>
            </div>
            <div className="rounded-lg overflow-hidden border border-default">
              <Editor
                height="180px"
                defaultLanguage="sql"
                theme={editorTheme.id}
                value={editing ? editedQuery : approval.query}
                onChange={(v) => setEditedQuery(v ?? "")}
                beforeMount={(monaco) => loadMonacoTheme(editorTheme, monaco)}
                options={{
                  readOnly: !editing,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  padding: { top: 12, bottom: 12 },
                  wordWrap: "on",
                }}
              />
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase font-bold text-muted">
                {t("aiApproval.preflightPlan")}
              </label>
              {explainPlan && (
                <button
                  onClick={() => setPlanExpanded(true)}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-primary hover:bg-surface-tertiary rounded transition-colors"
                  title={t("aiApproval.expandPlan")}
                >
                  <Maximize2 size={11} />
                  {t("aiApproval.expandPlan")}
                </button>
              )}
            </div>
            {explainPlan && planSummary ? (
              <PlanSummaryBox plan={explainPlan} summary={planSummary} />
            ) : (
              <div className="rounded-lg border border-default bg-base p-4 text-xs text-muted">
                {approval.explainError
                  ? t("aiApproval.explainFailed", {
                      error: approval.explainError,
                    })
                  : t("aiApproval.explainUnavailable")}
              </div>
            )}
          </section>

          <section>
            <label className="text-xs uppercase font-bold text-muted mb-2 block">
              {t("aiApproval.reasonLabel")}
            </label>
            {/* Prose field: natural-language input, so spellcheck/autocorrect stay ON; only the WebKit autofill pill is disabled. */}
            <input autoComplete="off" spellCheck={true}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("aiApproval.reasonPlaceholder")}
              className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-sm text-primary focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-between gap-3">
          <button
            onClick={handleDeny}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <X size={14} />
            {t("aiApproval.deny")}
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
            >
              {t("common.close")}
            </button>
            <button
              onClick={handleApprove}
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Check size={14} />
              {t("aiApproval.approve")}
            </button>
          </div>
        </div>
      </div>

      {planExpanded && explainPlan && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-[130] backdrop-blur-sm"
          onClick={() => setPlanExpanded(false)}
        >
          <div
            className="bg-elevated border border-strong rounded-xl shadow-2xl w-[95vw] h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b border-default bg-base">
              <h3 className="text-sm font-semibold text-primary">
                {t("aiApproval.preflightPlan")}
              </h3>
              <button
                onClick={() => setPlanExpanded(false)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-primary hover:bg-surface-tertiary rounded transition-colors"
                title={t("aiApproval.collapsePlan")}
                aria-label={t("aiApproval.collapsePlan")}
              >
                <Minimize2 size={12} />
                {t("aiApproval.collapsePlan")}
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-base">
              <VisualExplainView
                plan={explainPlan}
                isLoading={false}
                error={null}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                aiEnabled={false}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface PlanSummaryBoxProps {
  plan: ExplainPlan;
  summary: ExplainPlanSummary;
}

/**
 * Compact, read-only digest of the pre-flight plan: the same findings the
 * full explain overview surfaces, without the graph/diagram tabs. The full
 * `VisualExplainView` stays reachable through the "Expand" overlay.
 */
function PlanSummaryBox({ plan, summary }: PlanSummaryBoxProps) {
  const { t } = useTranslation();

  const findings = [
    summary.highestCostNode && {
      key: "highest-cost",
      label: t("editor.visualExplain.highestSelfCost"),
      value: formatCost(summary.highestCostNode.value),
      description: formatNodeLabel(
        summary.highestCostNode.nodeType,
        summary.highestCostNode.relation,
      ),
      icon: Layers2,
      iconClass: "text-blue-400",
    },
    summary.slowestNode && {
      key: "slowest-step",
      label: t("editor.visualExplain.slowestSelfStep"),
      value: formatTime(summary.slowestNode.value),
      description: formatNodeLabel(
        summary.slowestNode.nodeType,
        summary.slowestNode.relation,
      ),
      icon: Clock3,
      iconClass: "text-amber-400",
    },
    summary.largestRowMismatchNode?.ratio != null && {
      key: "estimate-gap",
      label: t("editor.visualExplain.largestEstimateGap"),
      value: formatRatio(summary.largestRowMismatchNode.value),
      description: t(
        summary.largestRowMismatchNode.ratio >= 1
          ? "editor.visualExplain.overEstimate"
          : "editor.visualExplain.underEstimate",
      ),
      icon: AlertTriangle,
      iconClass: "text-red-400",
    },
    summary.sequentialScans > 0 && {
      key: "sequential-scans",
      label: t("editor.visualExplain.sequentialScans"),
      value: String(summary.sequentialScans),
      description: t("editor.visualExplain.scanOperations"),
      icon: ScanSearch,
      iconClass: "text-amber-400",
    },
    summary.tempOperations > 0 && {
      key: "temp-operations",
      label: t("editor.visualExplain.tempOperations"),
      value: String(summary.tempOperations),
      description: t("editor.visualExplain.sortOrTempOperations"),
      icon: Database,
      iconClass: "text-fuchsia-400",
    },
  ].filter(Boolean);

  const rootRows = plan.root.plan_rows;
  const rootCost = plan.root.total_cost;

  return (
    <div className="rounded-lg border border-default bg-base p-3 space-y-2">
      {findings.length === 0 ? (
        <div className="text-xs text-muted">
          {t("editor.visualExplain.noIssues")}
        </div>
      ) : (
        findings.map((finding) => {
          if (!finding) {
            return null;
          }
          const Icon = finding.icon;
          return (
            <div key={finding.key} className="flex items-start gap-2 text-xs">
              <Icon size={13} className={`mt-0.5 shrink-0 ${finding.iconClass}`} />
              <span className="text-primary font-medium whitespace-nowrap">
                {finding.label}: {finding.value}
              </span>
              <span className="text-muted min-w-0 truncate">
                — {finding.description}
              </span>
            </div>
          );
        })
      )}
      {(rootRows != null || rootCost != null) && (
        <div className="text-[11px] text-muted pt-2 border-t border-default/60">
          {[
            rootRows != null &&
              `${t("aiApproval.planEstimatedRows")}: ${formatRows(rootRows)}`,
            rootCost != null &&
              `${t("editor.visualExplain.totalCost")}: ${formatCost(rootCost)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

function formatNodeLabel(nodeType: string, relation: string | null): string {
  return relation ? `${nodeType} · ${relation}` : nodeType;
}
