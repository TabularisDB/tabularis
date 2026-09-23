import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, Palette } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import type { DeepLinkInstallRequest } from "../../hooks/useDeepLinkInstall";
import type { RegistryPluginWithStatus } from "../../types/plugins";
import type { ThemeRegistrySnapshot } from "../../utils/themeDiscovery";
import { ThemeRegistryInstall } from "./ThemeRegistryInstall";
import { ThemeDialog } from "../ui/ThemeDialog";
import { ThemeDialogButton } from "../ui/ThemeDialogButton";
import { InlineBanner } from "../ui/InlineBanner";

interface ThemeDeepLinkInstallProps { request: DeepLinkInstallRequest; preview: RegistryPluginWithStatus; onClose: () => void }

export function ThemeDeepLinkInstall({ request, preview, onClose }: ThemeDeepLinkInstallProps) {
  const { t } = useTranslation();
  const { refreshCatalog } = useTheme();
  const [snapshot, setSnapshot] = useState<ThemeRegistrySnapshot>();
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void invoke<ThemeRegistrySnapshot>("fetch_theme_registry", { packageName: request.slug }).then((result) => { if (!disposed) setSnapshot(result); }).catch((failure) => { if (!disposed) setError(String(failure)); });
    return () => { disposed = true; };
  }, [request.slug]);
  const selectedPlugin = snapshot?.plugins.find((plugin) => plugin.id === request.slug);
  if (snapshot && selectedPlugin) return <ThemeRegistryInstall isOpen onClose={onClose} snapshot={snapshot} plugin={selectedPlugin} installedVersion={preview.installed_version} requestedRegistry={request.registry} initialVersion={request.version || ""} onCommitted={async () => { await refreshCatalog(); }} />;
  return <ThemeDialog isOpen onClose={onClose} icon={<Palette size={20} />} title={t("themePackages.installTitle")} subtitle={preview.name} widthClass="w-[560px]"
    footer={<ThemeDialogButton onClick={onClose}>{t("common.close")}</ThemeDialogButton>}>
    {error || snapshot
      ? <InlineBanner tone="red" role="alert" icon={<AlertTriangle size={16} />}><p className="break-words">{error || t("themePackages.noThemes")}</p></InlineBanner>
      : <InlineBanner tone="neutral" role="status" icon={<Loader2 size={16} className="animate-spin" />}>{t("themePackages.loading")}</InlineBanner>}
  </ThemeDialog>;
}
