import { useState } from "react";
import { useTranslation } from "react-i18next";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { CatalogTheme } from "../../types/themeCatalog";
import { exportThemePackage } from "../../utils/themePackageExport";
import { AlertTriangle, Info, Upload } from "lucide-react";
import { ThemeDialog } from "../ui/ThemeDialog";
import { ThemeDialogButton } from "../ui/ThemeDialogButton";
import { InlineBanner } from "../ui/InlineBanner";

interface ThemePackageExportModalProps { isOpen: boolean; onClose: () => void; theme: CatalogTheme }

export function ThemePackageExportModal({ isOpen, onClose, theme }: ThemePackageExportModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [minimum, setMinimum] = useState("");
  const [license, setLicense] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!isOpen) return null;
  const exportArchive = async () => {
    setBusy(true); setError("");
    try {
      const bytes = exportThemePackage(theme, { kind: "theme", name, version, min_runtime_version: minimum, theme_schema_version: 1, theme_variants: [{ id: "main", name: theme.entry.name, file: "themes/main.json" }] }, license);
      const path = await save({ defaultPath: `${name}-${version}-universal.zip`, filters: [{ name: "ZIP", extensions: ["zip"] }] });
      if (path) { await writeFile(path, bytes); onClose(); }
    } catch (failure) { setError(`${t("themePackages.exportError")} ${String(failure)}`); }
    finally { setBusy(false); }
  };
  return <ThemeDialog isOpen onClose={onClose} busy={busy} icon={<Upload size={20} />} title={t("themePackages.exportPackage")} subtitle={theme.entry.name}
    footer={<>
      <ThemeDialogButton disabled={busy} onClick={onClose}>{t("common.cancel")}</ThemeDialogButton>
      <ThemeDialogButton variant="primary" busy={busy} icon={<Upload size={16} />} disabled={!name.trim() || !version.trim() || !minimum.trim() || !license.trim() || !rights} onClick={() => void exportArchive()}>{t("themePackages.exportPackage")}</ThemeDialogButton>
    </>}>
    <InlineBanner tone="neutral" icon={<Info size={16} />}>{t("themePackages.licenseNotice")}</InlineBanner>
    <fieldset disabled={busy} className="space-y-4">
      <label className="block space-y-1.5 text-xs font-medium text-secondary">{t("themePackages.packageName")}<input data-autofocus value={name} maxLength={64} onChange={(event) => setName(event.target.value)} className="block w-full bg-base border border-strong rounded-lg px-3 py-2 text-sm font-normal text-primary focus:border-focus focus:outline-none disabled:opacity-50" /></label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5 text-xs font-medium text-secondary">{t("themePackages.version")}<input value={version} onChange={(event) => setVersion(event.target.value)} className="block w-full bg-base border border-strong rounded-lg px-3 py-2 text-sm font-normal text-primary focus:border-focus focus:outline-none disabled:opacity-50" /></label>
        <label className="block space-y-1.5 text-xs font-medium text-secondary">{t("themePackages.minimumRuntime")}<input value={minimum} onChange={(event) => setMinimum(event.target.value)} className="block w-full bg-base border border-strong rounded-lg px-3 py-2 text-sm font-normal text-primary focus:border-focus focus:outline-none disabled:opacity-50" /></label>
      </div>
      <p className="text-xs leading-relaxed text-muted">{t("themePackages.runtimeWarning")}</p>
      <label className="block space-y-1.5 text-xs font-medium text-secondary">{t("themePackages.license")}<textarea value={license} maxLength={256 * 1024} rows={5} onChange={(event) => setLicense(event.target.value)} className="block w-full resize-none bg-base border border-strong rounded-lg px-3 py-2 text-sm font-normal text-primary focus:border-focus focus:outline-none disabled:opacity-50" /></label>
      <label className="flex items-start gap-2 text-sm leading-relaxed text-secondary"><input type="checkbox" className="mt-1 shrink-0 accent-accent-primary" checked={rights} onChange={(event) => setRights(event.target.checked)} />{t("themePackages.rightsAcknowledged")}</label>
    </fieldset>
    {error && <InlineBanner tone="red" role="alert" icon={<AlertTriangle size={16} />}><p className="whitespace-pre-wrap break-words">{error}</p></InlineBanner>}
  </ThemeDialog>;
}
