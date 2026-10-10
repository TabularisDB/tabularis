import {
  X,
  FileText,
  Loader2,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";

export type ExportStatus = "exporting" | "completed" | "error";

interface ExportProgressModalProps {
  isOpen: boolean;
  status: ExportStatus;
  rowsProcessed: number;
  fileName: string;
  errorMessage?: string;
  warningMessage?: string;
  onCancel: () => void;
  onClose: () => void;
}

export const ExportProgressModal = ({
  isOpen,
  status,
  rowsProcessed,
  onCancel,
  onClose,
  fileName,
  errorMessage,
  warningMessage,
}: ExportProgressModalProps) => {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-lg shadow-xl w-96 p-6 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
            <FileText className="text-accent" />
            {status === "exporting"
              ? t("editor.exporting")
              : status === "completed"
              ? t("common.success")
              : t("common.error")}
          </h3>
        </div>

        <div className="flex flex-col items-center justify-center py-4 space-y-4">
          {status === "exporting" && (
            <Loader2 size={48} className="text-accent animate-spin" />
          )}
          {status === "completed" && (
            <CheckCircle size={48} className="text-accent-success animate-in zoom-in duration-300" />
          )}
          {status === "error" && (
            <AlertCircle size={48} className="text-accent-error animate-in zoom-in duration-300" />
          )}

          <div className="text-center space-y-1">
            <p
              className="text-secondary font-medium truncate max-w-[300px]"
              title={fileName}
            >
              {fileName}
            </p>
            {status === "error" ? (
              <p className="text-accent-error text-sm px-2 break-words">
                {errorMessage}
              </p>
            ) : (
              <>
                <p className="text-secondary text-sm">
                  {t("editor.rowsProcessed")}:{" "}
                  <span className="text-primary font-mono font-bold">
                    {rowsProcessed.toLocaleString()}
                  </span>
                </p>
                {warningMessage && (
                  <div className="mt-3 flex items-start gap-2 rounded border border-accent-warning/30 bg-accent-warning/10 px-3 py-2 text-left text-xs text-accent-warning">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{warningMessage}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          {status === "exporting" ? (
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-accent-error/15 hover:bg-accent-error/25 text-accent-error border border-accent-error/25 rounded flex items-center gap-2 transition-colors text-sm font-medium"
            >
              <X size={16} />
              {t("common.cancel")}
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-surface-tertiary hover:bg-surface-tertiary text-primary rounded flex items-center gap-2 transition-colors text-sm font-medium"
            >
              {t("common.close")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};

