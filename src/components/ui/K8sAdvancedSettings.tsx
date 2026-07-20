import { useState } from "react";
import { Check, ChevronDown, Loader2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { K8sPathOverrides } from "../../hooks/useK8sPathOverrides";

interface K8sAdvancedSettingsProps {
  pathOverrides: Pick<
    K8sPathOverrides,
    | "kubectlPath"
    | "kubeconfigPath"
    | "kubectlValidation"
    | "kubeconfigValidation"
    | "setPath"
    | "validatePath"
  >;
}

export function K8sAdvancedSettings({
  pathOverrides,
}: K8sAdvancedSettingsProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border border-default rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-secondary hover:text-primary hover:bg-surface-secondary transition-colors"
      >
        {t("k8sConnections.advancedSettings")}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={isOpen ? "rotate-180 transition-transform" : "transition-transform"}
        />
      </button>

      {isOpen && (
        <div className="px-3 pb-3 space-y-3 border-t border-default">
          <div className="pt-3">
            <label
              htmlFor="k8s-kubectl-path"
              className="block text-[10px] uppercase font-semibold tracking-wider text-muted mb-1"
            >
              {t("k8sConnections.kubectlPath")}
            </label>
            <div className="relative">
              <input
                id="k8s-kubectl-path"
                value={pathOverrides.kubectlPath}
                onChange={(event) =>
                  pathOverrides.setPath("kubectl", event.target.value)
                }
                onBlur={() => {
                  void pathOverrides.validatePath("kubectl");
                }}
                placeholder={t("k8sConnections.kubectlPathPlaceholder")}
                aria-invalid={pathOverrides.kubectlValidation.status === "error"}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                className={`w-full px-3 py-2 pr-9 bg-base border rounded-md text-sm text-primary placeholder:text-muted placeholder:italic focus:border-blue-500 focus:outline-none transition-colors ${
                  pathOverrides.kubectlValidation.status === "error"
                    ? "border-red-500"
                    : "border-strong"
                }`}
              />
              <span className="absolute inset-y-0 right-3 flex items-center">
                {pathOverrides.kubectlValidation.status === "validating" ? (
                  <Loader2 size={14} className="animate-spin text-muted" aria-hidden="true" />
                ) : pathOverrides.kubectlValidation.status === "valid" ? (
                  <Check size={14} className="text-green-400" aria-hidden="true" />
                ) : pathOverrides.kubectlValidation.status === "error" ? (
                  <XCircle size={14} className="text-red-400" aria-hidden="true" />
                ) : null}
              </span>
            </div>
            {pathOverrides.kubectlValidation.error && (
              <p role="alert" className="mt-1 text-xs text-red-400">
                {pathOverrides.kubectlValidation.error}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="k8s-kubeconfig-path"
              className="block text-[10px] uppercase font-semibold tracking-wider text-muted mb-1"
            >
              {t("k8sConnections.kubeconfigPath")}
            </label>
            <div className="relative">
              <input
                id="k8s-kubeconfig-path"
                value={pathOverrides.kubeconfigPath}
                onChange={(event) =>
                  pathOverrides.setPath("kubeconfig", event.target.value)
                }
                onBlur={() => {
                  void pathOverrides.validatePath("kubeconfig");
                }}
                placeholder={t("k8sConnections.kubeconfigPathPlaceholder")}
                aria-invalid={pathOverrides.kubeconfigValidation.status === "error"}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                className={`w-full px-3 py-2 pr-9 bg-base border rounded-md text-sm text-primary placeholder:text-muted placeholder:italic focus:border-blue-500 focus:outline-none transition-colors ${
                  pathOverrides.kubeconfigValidation.status === "error"
                    ? "border-red-500"
                    : "border-strong"
                }`}
              />
              <span className="absolute inset-y-0 right-3 flex items-center">
                {pathOverrides.kubeconfigValidation.status === "validating" ? (
                  <Loader2 size={14} className="animate-spin text-muted" aria-hidden="true" />
                ) : pathOverrides.kubeconfigValidation.status === "valid" ? (
                  <Check size={14} className="text-green-400" aria-hidden="true" />
                ) : pathOverrides.kubeconfigValidation.status === "error" ? (
                  <XCircle size={14} className="text-red-400" aria-hidden="true" />
                ) : null}
              </span>
            </div>
            {pathOverrides.kubeconfigValidation.error && (
              <p role="alert" className="mt-1 text-xs text-red-400">
                {pathOverrides.kubeconfigValidation.error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
