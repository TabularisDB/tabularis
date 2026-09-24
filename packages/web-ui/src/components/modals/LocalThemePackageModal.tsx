import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../hooks/useTheme";
import { useTabularisClient } from "../../hooks/useTabularisClient";
import { usePlatformCapabilities } from "../../hooks/usePlatformCapabilities";
import { THEME_PACKAGE_UPLOAD_PURPOSE, type LocalThemeArchiveRequest } from "../../api/contract";
import { toErrorMessage } from "../../utils/errors";
import type { LocalThemePreview, NativeThemeContribution } from "../../types/themeCatalog";
import { themePackageId } from "../../utils/themePackageIdentity";
import { AlertTriangle, Archive, CheckCircle2, Download, Eye, FolderOpen } from "lucide-react";
import clsx from "clsx";
import { ThemeDialog } from "../ui/ThemeDialog";
import { ThemeDialogButton } from "../ui/ThemeDialogButton";
import { InlineBanner } from "../ui/InlineBanner";
import { ThemeSqlSample } from "../ui/ThemeSqlSample";

interface LocalThemePackageModalProps { isOpen: boolean; onClose: () => void }

export function LocalThemePackageModal({ isOpen, onClose }: LocalThemePackageModalProps) {
  const { t } = useTranslation();
  const { previewTheme, cancelPreview, refreshCatalog } = useTheme();
  const client = useTabularisClient();
  const platform = usePlatformCapabilities();
  const [preview, setPreview] = useState<LocalThemePreview>();
  // Desktop reads the archive from its host path; browsers upload it once and
  // reuse the token for the install, which re-checks the previewed digest.
  const [archive, setArchive] = useState<LocalThemeArchiveRequest>();
  const [archiveLabel, setArchiveLabel] = useState("");
  const [selected, setSelected] = useState<NativeThemeContribution>();
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => cancelPreview, [cancelPreview]);
  if (!isOpen) return null;
  const choose = async () => {
    setBusy(true); setError(""); setPreview(undefined); setSelected(undefined); cancelPreview();
    try {
      const file = await platform.chooseInputFile({ filters: [{ name: "ZIP", extensions: ["zip"] }] });
      if (!file) return;
      const request: LocalThemeArchiveRequest = platform.negotiation.environment === "tauri"
        ? { path: file.reference }
        : { uploadToken: (await client.uploadFile({ contents: await platform.readInputBlob(file.reference), fileName: file.name, purpose: THEME_PACKAGE_UPLOAD_PURPOSE })).token };
      const result = await client.call("preview_local_theme_package", request);
      setArchive(request); setArchiveLabel("path" in request && request.path ? request.path : file.name); setPreview(result);
    } catch (failure) { setError(toErrorMessage(failure)); }
    finally { setBusy(false); }
  };
  const install = async () => {
    if (!preview || !archive) return;
    setBusy(true); setInstalling(true); setError("");
    try {
      const result = await client.call("install_local_theme_package", { ...archive, packageName: themePackageId(preview.manifest), expectedDigest: preview.digest });
      setCommitted(true); cancelPreview(); setError(result.warnings.join("\n"));
      try { await refreshCatalog(); }
      catch (failure) { setError(`${t("themePackages.committedRefreshFailed")} ${toErrorMessage(failure)}`); }
    } catch (failure) { setError(toErrorMessage(failure)); }
    finally { setBusy(false); setInstalling(false); }
  };
  const origin = preview?.variants[0]?.origin;
  return <ThemeDialog isOpen onClose={onClose} busy={busy} icon={<Archive size={20} />} title={t("themePackages.localPackage")}
    footer={<>
      {installing && origin?.kind === "installed"
        ? <ThemeDialogButton onClick={() => { void client.call("cancel_theme_install", { registryKey: origin.identity.registryKey, packageName: origin.identity.packageName }).catch((failure) => setError(toErrorMessage(failure))); }}>{t("common.cancel")}</ThemeDialogButton>
        : <ThemeDialogButton disabled={busy} onClick={onClose}>{t("common.close")}</ThemeDialogButton>}
      <ThemeDialogButton variant="primary" busy={installing} disabled={busy || committed || !preview} icon={<Download size={16} />} onClick={() => void install()}>{t("themePackages.install")}</ThemeDialogButton>
    </>}>
    <p className="text-sm leading-relaxed text-secondary">{t("themePackages.installHint")}</p>
    <div className="rounded-lg border border-dashed border-strong bg-base p-4 space-y-3">
      <ThemeDialogButton disabled={busy || committed} busy={busy && !installing} icon={<FolderOpen size={16} />} onClick={() => void choose()}>{t("themePackages.chooseArchive")}</ThemeDialogButton>
      {preview && <div className="space-y-1">
        <h3 className="text-sm font-semibold break-words">{preview.manifest.name} · {preview.manifest.version}</h3>
        <p className="text-xs font-mono text-muted break-all">{archiveLabel}</p>
      </div>}
    </div>
    {preview && <ul className="space-y-2">{preview.variants.map((variant) => <li key={variant.id}>
      <button type="button" disabled={busy || committed} aria-pressed={selected?.id === variant.id} onClick={() => { previewTheme(variant); setSelected(variant); }}
        className={clsx("flex w-full items-center gap-3 px-3 py-3 border rounded-lg text-left transition-colors focus-visible:outline focus-visible:outline-focus disabled:opacity-50 disabled:cursor-not-allowed", selected?.id === variant.id ? "border-accent-primary bg-accent-primary/10" : "border-default bg-base hover:bg-surface-secondary")}>
        <Eye size={16} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium break-words">{variant.name}</span><span className="block text-xs text-muted">{t(`themePackages.modes.${variant.mode}`)}</span></span>
        <span className="shrink-0 text-xs text-accent">{t("themePackages.preview")}</span>
      </button>
    </li>)}</ul>}
    {selected && !committed && <ThemeSqlSample contribution={selected} />}
    {error && <InlineBanner tone="red" role="alert" icon={<AlertTriangle size={16} />}><p className="whitespace-pre-wrap break-words">{error}</p></InlineBanner>}
    {committed && <InlineBanner tone="green" role="status" icon={<CheckCircle2 size={16} />}>{t("themePackages.installedHint")}</InlineBanner>}
  </ThemeDialog>;
}
