import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert, X } from "lucide-react";
import { Modal } from "../components/ui/Modal";
import { SqlPreview } from "../components/ui/SqlPreview";
import {
  ProductionGuardContext,
  snoozedConnectionIds,
  type GuardRequest,
} from "../hooks/useProductionGuard";

/**
 * Provider side of the production write guard: renders the confirmation
 * dialog requested by `useProductionGuard` (see hooks/useProductionGuard).
 */

interface PendingPrompt {
  connectionName: string;
  sql?: string;
  connectionId: string;
  resolve: (ok: boolean) => void;
}

export function ProductionGuardProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [snooze, setSnooze] = useState(false);

  const request = useCallback<GuardRequest>(
    (connectionId, connectionName, sql) => {
      return new Promise<boolean>((resolve) => {
        setSnooze(false);
        setPending({ connectionId, connectionName, sql, resolve });
      });
    },
    [],
  );

  const finish = (ok: boolean) => {
    if (!pending) return;
    if (ok && snooze && pending.connectionId) {
      snoozedConnectionIds.add(pending.connectionId);
    }
    pending.resolve(ok);
    setPending(null);
  };

  return (
    <ProductionGuardContext.Provider value={request}>
      {children}
      <Modal
        isOpen={pending !== null}
        onClose={() => finish(false)}
        overlayClassName="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] backdrop-blur-sm"
      >
        <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-default bg-base">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-900/30 rounded-lg">
                <TriangleAlert size={20} className="text-red-400" />
              </div>
              <h2 className="text-lg font-semibold text-primary">
                {t("environment.warnTitle")}
              </h2>
            </div>
            <button
              onClick={() => finish(false)}
              className="text-secondary hover:text-primary transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-6 space-y-4">
            <p className="text-sm text-secondary leading-relaxed">
              {t("environment.warnMessage", {
                name: pending?.connectionName ?? "",
              })}
            </p>
            {pending?.sql && <SqlPreview sql={pending.sql} height="120px" />}
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none w-fit">
              <input
                type="checkbox"
                checked={snooze}
                onChange={(e) => setSnooze(e.target.checked)}
              />
              {t("environment.warnSnooze")}
            </label>
          </div>

          <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
            <button
              onClick={() => finish(false)}
              className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={() => finish(true)}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {t("environment.warnConfirm")}
            </button>
          </div>
        </div>
      </Modal>
    </ProductionGuardContext.Provider>
  );
}
