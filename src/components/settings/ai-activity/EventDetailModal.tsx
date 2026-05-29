import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { AiActivityEvent } from "../../../types/ai";
import { formatDurationMs, formatLocalTimestamp } from "../../../utils/aiActivity";
import { useSettings } from "../../../hooks/useSettings";
import { StatusBadge } from "./StatusBadge";
import { QueryKindBadge } from "./QueryKindBadge";

interface EventDetailModalProps {
  event: AiActivityEvent;
  onClose: () => void;
}

export function EventDetailModal({ event, onClose }: EventDetailModalProps) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[640px] max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div>
            <h2 className="text-base font-semibold text-primary">
              {t("aiActivity.detailTitle")}
            </h2>
            <p className="text-xs text-muted font-mono">{event.id}</p>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto text-sm">
          <DetailRow
            label={t("aiActivity.col.timestamp")}
            value={formatLocalTimestamp(event.timestamp, settings.displayTimezone)}
          />
          <DetailRow label={t("aiActivity.col.tool")} value={event.tool} />
          <DetailRow
            label={t("aiActivity.col.connection")}
            value={
              event.connectionName
                ? `${event.connectionName} (${event.connectionId ?? "?"})`
                : "—"
            }
          />
          <DetailRow
            label={t("aiActivity.col.duration")}
            value={formatDurationMs(event.durationMs)}
          />
          <div className="flex gap-3">
            <div className="text-xs text-muted uppercase font-bold w-32 shrink-0">
              {t("aiActivity.col.status")}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={event.status} />
              {event.queryKind && <QueryKindBadge kind={event.queryKind} />}
            </div>
          </div>
          {event.clientHint && (
            <DetailRow label={t("aiActivity.client")} value={event.clientHint} />
          )}
          {event.rows !== null && event.rows !== undefined && (
            <DetailRow
              label={t("aiActivity.rowsReturned")}
              value={String(event.rows)}
            />
          )}
          {event.approvalId && (
            <DetailRow label={t("aiActivity.approvalId")} value={event.approvalId} />
          )}
          {event.error && (
            <div>
              <div className="text-xs text-muted uppercase font-bold mb-1">
                {t("common.error")}
              </div>
              <pre className="bg-red-900/10 border border-red-900/30 rounded p-3 text-xs text-red-400 whitespace-pre-wrap break-words">
                {event.error}
              </pre>
            </div>
          )}
          {event.query && (
            <div>
              <div className="text-xs text-muted uppercase font-bold mb-1">
                {t("aiActivity.col.query")}
              </div>
              <pre className="bg-base border border-default rounded p-3 text-xs text-secondary font-mono whitespace-pre-wrap break-words max-h-64 overflow-auto">
                {event.query}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <div className="text-xs text-muted uppercase font-bold w-32 shrink-0">
        {label}
      </div>
      <div className="text-primary text-sm break-all">{value}</div>
    </div>
  );
}
