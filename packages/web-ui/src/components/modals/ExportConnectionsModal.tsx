import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Download, Loader2, Lock, EyeOff, FileWarning } from "lucide-react";
import { PasswordInput } from "../ui/PasswordInput";

export type ExportMode = "encrypted" | "noSecrets" | "plaintext";

interface ExportConnectionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (mode: ExportMode, password?: string) => Promise<void>;
  /** When > 0, only that many selected connections will be exported. */
  selectedCount?: number;
}

export const ExportConnectionsModal = ({
  isOpen,
  onClose,
  onExport,
  selectedCount = 0,
}: ExportConnectionsModalProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ExportMode>("encrypted");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleClose = () => {
    setPassword("");
    setConfirmPassword("");
    setValidationError(null);
    onClose();
  };

  const options: {
    value: ExportMode;
    icon: typeof Lock;
    color: string;
    label: string;
    description: string;
  }[] = [
    {
      value: "encrypted",
      icon: Lock,
      color: "text-accent-success",
      label: t("connections.exportModal.encrypted"),
      description: t("connections.exportModal.encryptedDesc"),
    },
    {
      value: "noSecrets",
      icon: EyeOff,
      color: "text-accent",
      label: t("connections.exportModal.noSecrets"),
      description: t("connections.exportModal.noSecretsDesc"),
    },
    {
      value: "plaintext",
      icon: FileWarning,
      color: "text-accent-warning",
      label: t("connections.exportModal.plaintext"),
      description: t("connections.exportModal.plaintextDesc"),
    },
  ];

  const handleExport = async () => {
    if (mode === "encrypted") {
      if (!password) {
        setValidationError(t("connections.exportModal.passwordRequired"));
        return;
      }
      if (password !== confirmPassword) {
        setValidationError(t("connections.exportModal.passwordMismatch"));
        return;
      }
    }
    setValidationError(null);
    setLoading(true);
    try {
      await onExport(mode, mode === "encrypted" ? password : undefined);
      setPassword("");
      setConfirmPassword("");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent-primary/15 rounded-lg">
              <Download size={20} className="text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("connections.exportModal.title")}
              </h2>
              <p className="text-xs text-secondary">
                {selectedCount > 0
                  ? t("connections.exportModal.subtitleSelected", {
                      count: selectedCount,
                    })
                  : t("connections.exportModal.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="space-y-3">
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <label
                  key={option.value}
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    mode === option.value
                      ? "border-accent-primary bg-accent-primary/5"
                      : "border-default bg-base hover:border-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name="export-mode"
                    value={option.value}
                    checked={mode === option.value}
                    onChange={() => setMode(option.value)}
                    className="mt-1 accent-accent-primary"
                  />
                  <Icon size={18} className={`mt-0.5 shrink-0 ${option.color}`} />
                  <div>
                    <div className="font-medium text-primary text-sm">
                      {option.label}
                    </div>
                    <div className="text-xs text-secondary mt-1">
                      {option.description}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {mode === "encrypted" && (
            <div className="space-y-3 pt-1">
              <div>
                <label className="text-xs uppercase font-bold text-muted mb-1 block">
                  {t("connections.exportModal.password")}
                </label>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  autoFocus
                  aria-label={t("connections.exportModal.password")}
                />
              </div>
              <div>
                <label className="text-xs uppercase font-bold text-muted mb-1 block">
                  {t("connections.exportModal.confirmPassword")}
                </label>
                <PasswordInput
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  aria-label={t("connections.exportModal.confirmPassword")}
                />
              </div>
            </div>
          )}

          {mode === "plaintext" && (
            <div className="bg-accent-warning/10 border border-accent-warning/25 rounded-lg p-3">
              <p className="text-xs text-accent-warning leading-relaxed">
                {t("connections.exportWarning")}
              </p>
            </div>
          )}

          {validationError && (
            <p className="text-xs text-accent-error">{validationError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleExport}
            disabled={loading}
            className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 disabled:opacity-50 text-inverse rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {t("connections.exportModal.export")}
          </button>
        </div>
      </div>
    </div>
  );
};
