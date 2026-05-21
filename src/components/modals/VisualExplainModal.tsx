import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Network,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../hooks/useSettings";
import { useDatabase } from "../../hooks/useDatabase";
import { useDrivers } from "../../hooks/useDrivers";
import type { ExplainPlan } from "../../types/explain";
import { isDataModifyingQuery } from "../../utils/explainPlan";
import { isExplainableQuery } from "../../utils/sql";
import { getConnectionIcon } from "../../utils/driverUI";
import { VisualExplainView } from "../explain/VisualExplainView";
import type { ExplainViewMode } from "./visual-explain/ExplainSummaryBar";

interface VisualExplainModalProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  connectionId: string;
  schema?: string;
  /// Display label to use when the connection isn't loaded in the active
  /// database context (e.g. opened from the AI Activity panel). Falls back
  /// to the live connection name if available, then to `connectionId`.
  connectionLabel?: string;
}

export const VisualExplainModal = ({
  isOpen,
  onClose,
  query,
  connectionId,
  schema,
  connectionLabel,
}: VisualExplainModalProps) => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { getConnectionData, connections } = useDatabase();
  const { allDrivers } = useDrivers();
  const [plan, setPlan] = useState<ExplainPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ExplainViewMode>("graph");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const isDml = query ? isDataModifyingQuery(query) : false;
  const [analyze, setAnalyze] = useState(!isDml);
  const connectionData = getConnectionData(connectionId);
  const effectiveDriver =
    connectionData?.driver ?? plan?.driver ?? "sqlite";
  const driverManifest =
    allDrivers.find((driver) => driver.id === effectiveDriver) ?? null;
  const savedConnection = connections.find(c => c.id === connectionId) ?? null;
  const driverLabel = driverManifest?.name ?? effectiveDriver;
  const resolvedConnectionLabel =
    connectionData?.connectionName ?? connectionLabel ?? connectionId;
  const schemaLabel = schema ?? connectionData?.activeSchema ?? null;
  const databaseLabel = connectionData?.databaseName ?? schema ?? "";
  const locationLabel =
    schemaLabel && schemaLabel !== databaseLabel
      ? `${databaseLabel} / ${schemaLabel}`
      : databaseLabel;

  const handleExplain = useCallback(async () => {
    if (!query?.trim() || !connectionId) return;

    if (!isExplainableQuery(query)) {
      setError(t("editor.visualExplain.notExplainable"));
      return;
    }

    setIsLoading(true);
    setError(null);
    setPlan(null);

    try {
      const result = await invoke<ExplainPlan>("explain_query_plan", {
        connectionId,
        query,
        analyze,
        schema: schema || null,
      });
      setPlan(result);
      setSelectedNodeId(result.root.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [query, connectionId, analyze, schema, t]);

  useEffect(() => {
    if (isOpen && query?.trim() && connectionId) {
      setViewMode("graph");
      handleExplain();
    }
  }, [isOpen, query, connectionId, handleExplain]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[90vw] h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-900/30 rounded-lg">
              <Network size={20} className="text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("editor.visualExplain.title")}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <div className="inline-flex items-center gap-2 rounded-lg border border-default bg-surface-secondary/50 px-2.5 py-1 text-xs text-secondary">
                  <span className="text-primary">{getConnectionIcon(savedConnection, driverManifest, 14)}</span>
                  <span className="font-medium text-primary">
                    {resolvedConnectionLabel}
                  </span>
                </div>
                {locationLabel && (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-default bg-base/70 px-2.5 py-1 text-xs text-secondary">
                    <span className="uppercase tracking-wide text-muted">
                      {driverLabel}
                    </span>
                    <span className="text-muted">•</span>
                    <span className="font-mono">{locationLabel}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <VisualExplainView
          plan={plan}
          isLoading={isLoading}
          error={error}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          aiEnabled={!!settings.aiEnabled}
        />

        <div className="p-4 border-t border-default bg-base/50 flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={analyze}
              onChange={(e) => setAnalyze(e.target.checked)}
              className="rounded border-strong"
            />
            {t("editor.visualExplain.analyze")}
          </label>

          {isDml && (
            <div className="flex items-center gap-1.5 text-xs text-warning-text">
              <AlertTriangle size={12} />
              <span>{t("editor.visualExplain.analyzeWarning")}</span>
            </div>
          )}

          <div className="flex-1" />

          <button
            onClick={handleExplain}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
            {t("editor.visualExplain.rerun")}
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("editor.visualExplain.close")}
          </button>
        </div>
      </div>
    </div>
  );
};
