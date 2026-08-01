import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eraser, RefreshCw, X } from "lucide-react";
import {
  generateAnonymizeKey,
  type AnonymizeSpec,
} from "../../utils/anonymize";

type RuleKind = "none" | "null" | "fixed" | "partial" | "hmac";

interface ColumnRuleState {
  kind: RuleKind;
  fixedValue: string;
  keepStart: number;
  keepEnd: number;
}

const DEFAULT_RULE_STATE: ColumnRuleState = {
  kind: "none",
  fixedValue: "***",
  keepStart: 1,
  keepEnd: 0,
};

interface ExportAnonymizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Columns of the current result set, in export order. */
  columns: string[];
  onExport: (format: "csv" | "json" | "markdown", spec: AnonymizeSpec) => void;
}

/**
 * Optional anonymization step for file exports (#483): assign a per-column
 * rule (NULL, fixed value, partial mask, deterministic HMAC pseudonym) before
 * the file is written. Presented as anonymization/pseudonymization — not as
 * a "GDPR compliance" guarantee.
 */
export function ExportAnonymizeModal(props: ExportAnonymizeModalProps) {
  // Remount on every open so rules and the per-export key start fresh.
  if (!props.isOpen) return null;
  return <ExportAnonymizeModalInner {...props} />;
}

function ExportAnonymizeModalInner({
  onClose,
  columns,
  onExport,
}: Omit<ExportAnonymizeModalProps, "isOpen">) {
  const { t } = useTranslation();
  const [ruleState, setRuleState] = useState<Record<string, ColumnRuleState>>(
    {},
  );
  const [key, setKey] = useState(generateAnonymizeKey);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const updateRule = (col: string, patch: Partial<ColumnRuleState>) =>
    setRuleState((prev) => ({
      ...prev,
      [col]: { ...DEFAULT_RULE_STATE, ...prev[col], ...patch },
    }));

  const buildSpec = (): AnonymizeSpec => {
    const rules: AnonymizeSpec["rules"] = {};
    for (const col of columns) {
      const state = ruleState[col];
      if (!state || state.kind === "none") continue;
      switch (state.kind) {
        case "null":
          rules[col] = { type: "fixed", value: null };
          break;
        case "fixed":
          rules[col] = { type: "fixed", value: state.fixedValue };
          break;
        case "partial":
          rules[col] = {
            type: "partial",
            keep_start: state.keepStart,
            keep_end: state.keepEnd,
          };
          break;
        case "hmac":
          rules[col] = { type: "hmac" };
          break;
      }
    }
    return { key, rules };
  };

  const handleExport = (format: "csv" | "json" | "markdown") => {
    onClose();
    onExport(format, buildSpec());
  };

  const SELECT_CLASS =
    "w-32 px-2 py-1.5 bg-base border border-strong rounded-lg text-sm text-primary focus:border-blue-500 focus:outline-none";
  const INPUT_CLASS =
    "px-2 py-1.5 bg-base border border-strong rounded-lg text-sm text-primary focus:border-blue-500 focus:outline-none";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-900/30 rounded-lg">
              <Eraser size={20} className="text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("exportAnonymize.title")}
              </h2>
              <p className="text-xs text-secondary">
                {t("exportAnonymize.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto">
          <div className="bg-surface-secondary/50 p-4 rounded-lg border border-strong">
            <p className="text-sm text-secondary leading-relaxed">
              {t("exportAnonymize.description")}
            </p>
          </div>

          {/* Per-export pseudonymization key */}
          <div>
            <label className="text-xs uppercase font-bold text-muted mb-1 block">
              {t("exportAnonymize.keyLabel")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                spellCheck={false}
                className={`${INPUT_CLASS} flex-1 font-mono`}
              />
              <button
                onClick={() => setKey(generateAnonymizeKey())}
                title={t("exportAnonymize.regenerate")}
                className="p-2 bg-surface-secondary text-secondary hover:text-primary rounded-lg transition-all"
              >
                <RefreshCw size={16} />
              </button>
            </div>
            <p className="text-xs text-muted mt-1">
              {t("exportAnonymize.keyDescription")}
            </p>
          </div>

          {/* Per-column rules */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="flex-1 text-xs uppercase font-bold text-muted">
                {t("exportAnonymize.column")}
              </span>
              <span className={`${SELECT_CLASS} border-transparent uppercase font-bold text-xs text-muted`}>
                {t("exportAnonymize.rule")}
              </span>
            </div>
            <div className="divide-y divide-default border border-default rounded-lg px-3">
              {columns.map((col) => {
                const state = ruleState[col] ?? DEFAULT_RULE_STATE;
                return (
                  <div key={col} className="flex items-center gap-2 py-1.5">
                    <span
                      className="flex-1 font-mono text-sm text-primary truncate"
                      title={col}
                    >
                      {col}
                    </span>
                    {state.kind === "fixed" && (
                      <input
                        type="text"
                        value={state.fixedValue}
                        onChange={(e) =>
                          updateRule(col, { fixedValue: e.target.value })
                        }
                        className={`${INPUT_CLASS} w-24 font-mono`}
                      />
                    )}
                    {state.kind === "partial" && (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <input
                          type="number"
                          min={0}
                          max={9}
                          value={state.keepStart}
                          onChange={(e) =>
                            updateRule(col, {
                              keepStart: Math.max(
                                0,
                                parseInt(e.target.value) || 0,
                              ),
                            })
                          }
                          title={t("exportAnonymize.keepStart")}
                          className={`${INPUT_CLASS} w-14`}
                        />
                        <input
                          type="number"
                          min={0}
                          max={9}
                          value={state.keepEnd}
                          onChange={(e) =>
                            updateRule(col, {
                              keepEnd: Math.max(
                                0,
                                parseInt(e.target.value) || 0,
                              ),
                            })
                          }
                          title={t("exportAnonymize.keepEnd")}
                          className={`${INPUT_CLASS} w-14`}
                        />
                      </span>
                    )}
                    <select
                      value={state.kind}
                      onChange={(e) =>
                        updateRule(col, { kind: e.target.value as RuleKind })
                      }
                      className={SELECT_CLASS}
                    >
                      <option value="none">
                        {t("exportAnonymize.ruleNone")}
                      </option>
                      <option value="null">
                        {t("exportAnonymize.ruleNull")}
                      </option>
                      <option value="fixed">
                        {t("exportAnonymize.ruleFixed")}
                      </option>
                      <option value="partial">
                        {t("exportAnonymize.rulePartial")}
                      </option>
                      <option value="hmac">
                        {t("exportAnonymize.ruleHmac")}
                      </option>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer: pick the format to start the export */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => handleExport("csv")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            CSV
          </button>
          <button
            onClick={() => handleExport("json")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            JSON
          </button>
          <button
            onClick={() => handleExport("markdown")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Markdown
          </button>
        </div>
      </div>
    </div>
  );
}
