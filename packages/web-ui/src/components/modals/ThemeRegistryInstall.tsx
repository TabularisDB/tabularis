import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePlatformCapabilities } from "../../hooks/usePlatformCapabilities";
import { useTabularisClient } from "../../hooks/useTabularisClient";
import { toErrorMessage } from "../../utils/errors";
import { AlertTriangle, BookOpen, CheckCircle2, Download, ExternalLink, Info, Loader2, Palette, RefreshCw } from "lucide-react";
import { APP_VERSION } from "../../version";
import { ThemeDialog } from "../ui/ThemeDialog";
import { ThemeDialogButton } from "../ui/ThemeDialogButton";
import { Chip } from "../ui/Chip";
import { InlineBanner } from "../ui/InlineBanner";
import { PluginKindChip } from "../plugins/PluginKindChip";
import { stripTrailingSlash } from "../../utils/pluginPresentation";
import { ThemeReadmeModal } from "./ThemeReadmeModal";
import { themeDownloadCount, isCompatibleThemeRelease, type ThemeRegistryPlugin, type ThemeRegistrySnapshot } from "../../utils/themeDiscovery";

interface ThemeRegistryInstallProps {
  isOpen: boolean;
  onClose: () => void;
  snapshot: ThemeRegistrySnapshot;
  plugin: ThemeRegistryPlugin;
  onCommitted: () => Promise<void>;
  /** Version of this package already installed, including manual bundles. */
  installedVersion?: string | null;
  initialVersion?: string;
  requestedRegistry?: string | null;
}

/**
 * Explicit install/update dialog for one declarative theme package. Same
 * anatomy as the driver install confirmation (hero, registry strip, banners,
 * footer actions) so both kinds read the same; only the install path differs.
 */
export function ThemeRegistryInstall({ isOpen, onClose, snapshot, plugin, onCommitted, installedVersion = null, initialVersion = "", requestedRegistry = null }: ThemeRegistryInstallProps) {
  const { t, i18n } = useTranslation();
  const platform = usePlatformCapabilities();
  const client = useTabularisClient();
  const [detail, setDetail] = useState<ThemeRegistryPlugin>();
  const [version, setVersion] = useState(initialVersion);
  const [readme, setReadme] = useState(false);
  const readmeButton = useRef<HTMLButtonElement>(null);
  const returningFromReadme = useRef(false);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    void client.call("fetch_theme_package_detail", { packageName: plugin.id, expectedRegistryKey: snapshot.registryKey, requestedRegistryUrl: requestedRegistry }).then((value) => { if (!disposed) setDetail(value); }).catch((failure) => { if (!disposed) setError(toErrorMessage(failure)); });
    return () => { disposed = true; };
  }, [client, plugin.id, snapshot.registryKey, requestedRegistry, isOpen]);
  useEffect(() => {
    if (isOpen && !readme && returningFromReadme.current) { readmeButton.current?.focus(); returningFromReadme.current = false; }
  }, [isOpen, readme]);
  if (!isOpen) return null;
  if (readme) return <ThemeReadmeModal key={`${plugin.id}:${i18n.resolvedLanguage ?? i18n.language}`} plugin={detail ?? plugin} registryUrl={snapshot.registryUrl} onClose={() => setReadme(false)} />;
  const target = version || detail?.latest_version || plugin.latest_version;
  const release = detail?.releases.find((candidate) => candidate.version === target);
  const compatible = release && isCompatibleThemeRelease(release, APP_VERSION);
  const downloads = themeDownloadCount(detail?.downloads ?? plugin.downloads, i18n.resolvedLanguage ?? i18n.language);
  const isUpdate = !!installedVersion && installedVersion !== target;
  const registryPageUrl = `${stripTrailingSlash(snapshot.registryUrl)}/plugins/${plugin.id}`;
  const install = async () => {
    setBusy(true); setError("");
    try {
      const result = await client.call("install_registry_theme", { packageName: plugin.id, expectedRegistryKey: snapshot.registryKey, version: version || null });
      setCommitted(true);
      setError(result.warnings.join("\n"));
      try { await onCommitted(); }
      catch (failure) { setError(`${t("themePackages.committedRefreshFailed")} ${toErrorMessage(failure)}`); }
    } catch (failure) { setError(toErrorMessage(failure)); }
    finally { setBusy(false); }
  };
  const actionLabel = `${t(isUpdate ? "settings.plugins.update" : "settings.plugins.install")} v${target}`;
  const footer = <>
    <ThemeDialogButton ref={readmeButton} disabled={busy} onClick={() => { returningFromReadme.current = true; setReadme(true); }} className="mr-auto" icon={<BookOpen size={16} />}>
      {t("themePackages.readme")}
    </ThemeDialogButton>
    {busy
      ? <ThemeDialogButton onClick={() => { void client.call("cancel_theme_install", { registryKey: snapshot.registryKey, packageName: plugin.id }).catch((failure) => setError(toErrorMessage(failure))); }}>{t("common.cancel")}</ThemeDialogButton>
      : <ThemeDialogButton onClick={onClose}>{t("common.close")}</ThemeDialogButton>}
    <ThemeDialogButton variant="primary" busy={busy} disabled={!compatible || committed} onClick={() => void install()} title={release?.min_tabularis_version && !compatible ? t("themePackages.minimumVersion", { version: release.min_tabularis_version }) : undefined}
      icon={isUpdate ? <RefreshCw size={16} /> : <Download size={16} />}>
      {busy ? t("deepLink.installing") : actionLabel}
    </ThemeDialogButton>
  </>;
  return <ThemeDialog isOpen onClose={onClose} busy={busy} icon={<Palette size={18} />} title={t("themePackages.installTitle")} subtitle={t("themePackages.installSubtitle")} widthClass="w-[560px]" footer={footer}>
    {/* Hero: tile + name + identity chips, like the driver install confirmation. */}
    <div className="flex items-start gap-4">
      <div className="h-14 w-14 shrink-0 rounded-xl border border-default flex items-center justify-center text-white shadow-md" style={{ backgroundColor: "var(--accent-secondary)" }}><Palette size={24} /></div>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => void platform.openExternalUrl(registryPageUrl)} title={registryPageUrl} className="inline-flex min-w-0 items-center gap-1 text-left text-base font-semibold text-primary hover:underline underline-offset-4 decoration-accent-primary/60">
          <span className="truncate">{plugin.name}</span><ExternalLink size={12} className="shrink-0 text-muted" />
        </button>
        <p className="mt-0.5 text-[11px] text-muted font-mono truncate">{plugin.id}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <PluginKindChip kind="theme" />
          <Chip>v{target}</Chip>
          {installedVersion && <Chip tone={installedVersion === target ? "success" : "neutral"} icon={installedVersion === target ? <CheckCircle2 size={9} aria-hidden="true" /> : undefined}>{t("themePackages.installedVersion", { version: installedVersion })}</Chip>}
        </div>
      </div>
    </div>
    <p className="text-xs leading-relaxed text-secondary">{plugin.description}</p>
    <div className="flex items-center justify-between text-[11px] text-muted">
      <span>{t("settings.plugins.by")} <span className="text-secondary">{plugin.author}</span></span>
      <span title={downloads?.exact} aria-label={downloads ? t("themePackages.downloads", { count: downloads.exact }) : undefined} className="inline-flex items-center gap-1"><Download size={11} aria-hidden="true" />{downloads ? t("themePackages.downloads", { count: downloads.compact }) : t("themePackages.downloadsUnavailable")}</span>
    </div>
    <div className="flex items-center justify-between rounded-lg border border-default bg-base/60 px-3 py-2 text-[11px]">
      <span className="text-muted uppercase tracking-wider">{t("deepLink.registry")}</span>
      <button type="button" onClick={() => void platform.openExternalUrl(snapshot.registryUrl)} title={snapshot.registryUrl} className="inline-flex items-center gap-1 font-mono text-primary hover:underline underline-offset-2 truncate ml-2">
        <span className="truncate">{snapshot.registryUrl}</span><ExternalLink size={11} className="shrink-0 text-muted" />
      </button>
    </div>
    <div>
      <label htmlFor="theme-package-version" className="text-xs uppercase font-bold text-muted mb-1 block">{t("themePackages.version")}</label>
      <select id="theme-package-version" value={version} disabled={busy || committed || !detail} onChange={(event) => setVersion(event.target.value)} className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-sm text-primary focus:border-focus focus:outline-none disabled:opacity-60">
        <option value="">{t("themePackages.latest")}{detail ? ` (v${detail.latest_version})` : ""}</option>
        {detail?.releases.map((candidate) => <option key={candidate.version} value={candidate.version}>v{candidate.version}{candidate.version === installedVersion ? ` · ${t("settings.plugins.installed")}` : ""}</option>)}
      </select>
      <p className="mt-1.5 text-[11px] text-muted leading-relaxed">{t("themePackages.installHint")}</p>
    </div>
    {release?.min_tabularis_version && <InlineBanner tone="neutral" icon={<Info size={13} />}><p>{t("themePackages.minimumVersion", { version: release.min_tabularis_version })}</p></InlineBanner>}
    {detail && !compatible && <InlineBanner tone="amber" role="status" icon={<AlertTriangle size={13} />}><p>{t("themePackages.incompatible")}</p></InlineBanner>}
    {!detail && !error && <InlineBanner tone="neutral" role="status" icon={<Loader2 size={13} className="animate-spin" />}><p>{t("themePackages.loading")}</p></InlineBanner>}
    {error && <InlineBanner tone="red" role="alert" icon={<AlertTriangle size={13} />}><pre className="font-mono whitespace-pre-wrap break-all text-[11px]">{error}</pre></InlineBanner>}
    {committed && <InlineBanner tone="green" role="status" icon={<CheckCircle2 size={13} />}><p className="font-medium">{t("themePackages.installedHint")}</p></InlineBanner>}
  </ThemeDialog>;
}
