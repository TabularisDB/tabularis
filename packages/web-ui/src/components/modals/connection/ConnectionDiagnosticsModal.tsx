import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Plug,
  Square,
  X,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { Modal } from "../../ui/Modal";
import type { ClassifiedConnectionError } from "../../../utils/connectionErrors";
import {
  formatDiagnosticsReport,
  formatTestLogTime,
  testStepLabelKey,
  type ConnectionTestLogEntry,
} from "../../../utils/connectionTest";

interface ConnectionDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  error: ClassifiedConnectionError | null;
  log: ConnectionTestLogEntry[];
}

const STATUS_ICONS = {
  start: <Circle size={12} className="text-muted" />,
  ok: <CheckCircle2 size={12} className="text-green-400" />,
  error: <XCircle size={12} className="text-red-400" />,
  cancelled: <Square size={12} className="text-muted" />,
} as const;

/**
 * Diagnostics for a connection test, stacked above the connection modal:
 * classified summary and recovery hint (when the test failed), the
 * step-by-step test log, and the raw backend error, with a copy-to-clipboard
 * report. Without an error (e.g. a stopped test) it shows the log alone.
 */
export const ConnectionDiagnosticsModal = ({
  isOpen,
  onClose,
  error,
  log,
}: ConnectionDiagnosticsModalProps) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const title = error ? t(error.summaryKey) : t("connectionTest.title");
  const logLines = log.map(
    (entry) =>
      `${formatTestLogTime(entry.timestamp)}  ${t(testStepLabelKey(entry), {
        defaultValue: entry.step,
      })}${entry.detail ? ` (${entry.detail})` : ""}`,
  );

  const copyReport = async () => {
    const report = formatDiagnosticsReport({
      summary: title,
      recovery: error?.recoveryKey ? t(error.recoveryKey) : null,
      logLines,
      detail: error?.detail || null,
    });
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy diagnostics:", err);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] backdrop-blur-sm"
    >
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-default bg-base flex items-start gap-3">
          <div
            className={clsx(
              "w-9 h-9 rounded-lg border flex items-center justify-center shrink-0",
              error
                ? "bg-red-500/10 border-red-500/20"
                : "bg-blue-500/10 border-blue-500/20",
            )}
          >
            {error ? (
              <AlertCircle size={18} className="text-red-400" />
            ) : (
              <Plug size={18} className="text-blue-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-primary">{title}</h2>
            {error?.recoveryKey && (
              <p className="mt-0.5 text-xs text-secondary leading-relaxed">
                {t(error.recoveryKey)}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-muted hover:text-primary transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <h3 className="text-xs uppercase font-bold text-muted mb-2">
              {t("connectionTest.logTitle")}
            </h3>
            {log.length === 0 ? (
              <p className="text-xs text-muted italic">
                {t("connectionTest.noLog")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {log.map((entry, index) => (
                  <li
                    key={`${entry.step}-${entry.status}-${index}`}
                    className="flex items-start gap-2 text-xs"
                  >
                    <span className="mt-0.5 shrink-0">
                      {STATUS_ICONS[entry.status]}
                    </span>
                    <span className="font-mono text-muted shrink-0">
                      {formatTestLogTime(entry.timestamp)}
                    </span>
                    <span className="text-secondary min-w-0">
                      {t(testStepLabelKey(entry), {
                        defaultValue: entry.step,
                      })}
                      {entry.detail && entry.status !== "error" && (
                        <span className="text-muted"> ({entry.detail})</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error?.detail && (
            <div>
              <h3 className="text-xs uppercase font-bold text-muted mb-2">
                {t("connectionTest.rawError")}
              </h3>
              <pre className="p-2.5 max-h-48 overflow-auto rounded-lg bg-base border border-strong text-[11px] leading-relaxed text-red-300/90 font-mono whitespace-pre-wrap break-words select-text">
                {error.detail}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={copyReport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-secondary hover:text-primary hover:bg-surface-secondary rounded-md border border-strong transition-colors"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied
              ? t("connectionTest.copied")
              : t("connectionTest.copyDiagnostics")}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
};
