import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePendingApprovals } from "../../hooks/useAiActivity";
import { useSettings } from "../../hooks/useSettings";
import {
  focusWindowForApproval,
  notifyApprovalRequest,
  restoreWindowAlwaysOnTop,
} from "../../utils/mcpApprovalAttention";
import { AiApprovalModal } from "./AiApprovalModal";

/// Listens for `ai://pending_approval` events emitted by the file watcher
/// and presents one approval modal at a time. Mounted once at the App
/// level, so it shows over any current page.
export function AiApprovalGate() {
  const { t } = useTranslation();
  const {
    settings,
    isLoading: isSettingsLoading,
  } = useSettings();
  const { pending, decide } = usePendingApprovals();
  const current = pending[0];
  const currentApprovalId = current?.id ?? null;
  const attentionApprovalIdRef = useRef<string | null>(null);
  const notifiedApprovalIdRef = useRef<string | null>(null);
  const approvalRunIdRef = useRef(0);

  const restoreWindowState = useCallback(async () => {
    await restoreWindowAlwaysOnTop(attentionApprovalIdRef.current);
    attentionApprovalIdRef.current = null;
  }, []);

  useEffect(() => {
    const runId = ++approvalRunIdRef.current;

    if (isSettingsLoading) {
      return;
    }

    if (!currentApprovalId) {
      void restoreWindowState();
      notifiedApprovalIdRef.current = null;
      return;
    }

    const bringToFront = settings.mcpApprovalAlwaysOnTop ?? true;
    const sendNotification = settings.mcpApprovalNotifySound ?? true;

    void (async () => {
      if (bringToFront && attentionApprovalIdRef.current !== currentApprovalId) {
        attentionApprovalIdRef.current = currentApprovalId;
        await focusWindowForApproval(currentApprovalId);
      } else if (!bringToFront && attentionApprovalIdRef.current) {
        await restoreWindowState();
      }

      if (approvalRunIdRef.current !== runId) return;

      if (sendNotification && notifiedApprovalIdRef.current !== currentApprovalId) {
        notifiedApprovalIdRef.current = currentApprovalId;
        const title = t("aiApproval.notificationTitle");
        const body = t("aiApproval.notificationBody");
        await notifyApprovalRequest({ title, body });
      }
    })();
  }, [currentApprovalId, isSettingsLoading, restoreWindowState, settings.mcpApprovalAlwaysOnTop, settings.mcpApprovalNotifySound, t]);

  useEffect(() => {
    return () => {
      void restoreWindowState();
    };
  }, [restoreWindowState]);

  if (!current) return null;

  const handleClose = () => {
    // Closing without an explicit decision is treated as deny — the MCP
    // subprocess is blocked waiting on us, so silent dismissal would just
    // burn the timeout.
    decide({
      approvalId: current.id,
      decision: "deny",
      reason: "dismissed",
    }).catch(() => {});
  };

  return (
    <AiApprovalModal
      approval={current}
      onApprove={(editedQuery) =>
        decide({
          approvalId: current.id,
          decision: "approve",
          editedQuery,
        })
      }
      onDeny={(reason) =>
        decide({
          approvalId: current.id,
          decision: "deny",
          reason,
        })
      }
      onClose={handleClose}
    />
  );
}
