import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Copy, Download, Eye, FileJson, FolderOpen, Info, Package, Palette, Pencil, Power, RefreshCw, Trash2, Upload, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useTheme } from "../../hooks/useTheme";
import { useSettings } from "../../hooks/useSettings";
import type { CatalogTheme } from "../../types/themeCatalog";
import type { Theme } from "../../types/theme";
import { themeRegistry } from "../../themes/themeRegistry";
import { SettingButtonGroup, SettingRow, SettingSection } from "./SettingControls";
import { ThemePicker } from "./ThemePicker";
import { ThemeActionsMenu, type ThemeMenuItem } from "./ThemeActionsMenu";
import { ThemeDialog } from "../ui/ThemeDialog";
import { ThemeDialogButton } from "../ui/ThemeDialogButton";
import { InlineBanner } from "../ui/InlineBanner";
import { ThemeSqlSample } from "../ui/ThemeSqlSample";
import { ThemeDocumentModal } from "../modals/ThemeDocumentModal";
import { LocalThemePackageModal } from "../modals/LocalThemePackageModal";
import { ThemePackageExportModal } from "../modals/ThemePackageExportModal";
import { ThemeRecoveryModal } from "../modals/ThemeRecoveryModal";

type ThemeAction = { kind: "preview"; theme: CatalogTheme; apply: () => Promise<void> }
  | { kind: "duplicate" | "delete"; theme: CatalogTheme }
  | { kind: "package"; theme: CatalogTheme; operation: "disable" | "enable" | "remove" };

export function ThemeManager() {
  const { t } = useTranslation();
  const themes = useTheme();
  const { settings } = useSettings();
  const [document, setDocument] = useState<{ kind: "tabularis" | "vscode" | "edit"; original?: CatalogTheme }>();
  const [action, setAction] = useState<ThemeAction>();
  const [, setSearchParams] = useSearchParams();
  // Theme discovery lives in the Plugin Center with the other registry kinds;
  // this only jumps there with the kind filter preset.
  const browseThemes = () => setSearchParams((previous) => {
    const next = new URLSearchParams(previous);
    next.set("tab", "plugins");
    next.set("kind", "theme");
    next.delete("filter");
    return next;
  }, { replace: true });
  const [local, setLocal] = useState(false);
  const [recover, setRecover] = useState(false);
  const [exporting, setExporting] = useState<CatalogTheme>();
  const [error, setError] = useState("");
  const saveRequest = useRef(0);
  const saveThemeChoice = (operation: () => Promise<void>) => {
    const request = ++saveRequest.current;
    setError("");
    void operation().catch((failure) => {
      if (request === saveRequest.current) setError(String(failure));
    });
  };
  const entries = new Map(themes.catalog.themes.map((theme) => [theme.entry.id, theme]));
  // The catalog also includes disabled packages, which must remain manageable.
  const pickerThemes = entries.size ? themes.catalog.themes.map((theme) => theme.resolved.theme) : themes.allThemes;
  const savedIds = [themes.settings.activeThemeId, themes.settings.lightThemeId, themes.settings.darkThemeId, settings.editorTheme].filter((id): id is string => !!id);
  const missing = [...new Set(savedIds.filter((id) => !themes.catalog.themes.some(({ entry }) => entry.id === id && entry.available)))];
  const exportJSON = async (theme: CatalogTheme) => {
    try {
      const source = await themes.exportTheme(theme.entry.id);
      const path = await save({ defaultPath: "theme.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (path) await writeTextFile(path, source);
    } catch (failure) { setError(String(failure)); }
  };
  const renderActions = (choice: Theme, apply: () => Promise<void>) => {
    const theme = entries.get(choice.id);
    if (!theme) return null;
    const { entry } = theme;
    const items: ThemeMenuItem[] = [
      { label: t("themePackages.preview"), icon: Eye, disabled: !entry.available, onSelect: () => { themes.previewTheme(entry.id); setAction({ kind: "preview", theme, apply }); } },
      { label: t("themePackages.duplicate"), icon: Copy, disabled: !entry.available, onSelect: () => setAction({ kind: "duplicate", theme }) },
      { label: t("themePackages.exportJSON"), icon: FileJson, separatorBefore: true, onSelect: () => void exportJSON(theme) },
      { label: t("themePackages.exportPackage"), icon: Upload, onSelect: () => setExporting(theme) },
    ];
    if (entry.origin.kind === "personal") items.push(
      { label: t("themePackages.edit"), icon: Pencil, separatorBefore: true, onSelect: () => setDocument({ kind: "edit", original: theme }) },
      { label: t("themePackages.remove"), icon: Trash2, danger: true, onSelect: () => setAction({ kind: "delete", theme }) },
    );
    if (entry.origin.kind === "installed") {
      items.push(
        { label: t(`themePackages.${entry.available ? "disable" : "enable"}`), icon: Power, separatorBefore: true, onSelect: () => setAction({ kind: "package", theme, operation: entry.available ? "disable" : "enable" }) },
        { label: t("themePackages.removePackage"), icon: Trash2, danger: true, onSelect: () => setAction({ kind: "package", theme, operation: "remove" }) },
      );
    }
    return <ThemeActionsMenu label={`${t("themePackages.manage")} — ${entry.name}`} items={items} disabled={themes.isLoading} />;
  };
  const renderPicker = (choices: Theme[], value: string, select: (id: string) => Promise<void>) => <ThemePicker
    themes={choices} value={value} disabled={themes.isLoading}
    onChange={(id) => saveThemeChoice(() => select(id))}
    isUnavailable={(theme) => entries.get(theme.id)?.entry.available === false}
    renderActions={(theme) => renderActions(theme, () => select(theme.id))}
    renderDetails={(choice) => {
      const theme = entries.get(choice.id);
      if (!theme) return null;
      const { origin, mode } = theme.entry;
      const attribution = theme.resolved.source.kind === "v1" ? theme.resolved.source.value.attribution : theme.resolved.theme.author;
      return <div className="flex items-center justify-between gap-1" title={origin.kind === "installed" ? `${origin.identity.packageName} · ${origin.packageVersion}` : attribution}>
        <span className="truncate">{t(`themePackages.groups.${origin.kind}`)}</span>
        <span className="shrink-0 opacity-70">{t(`themePackages.modes.${mode}`)}</span>
      </div>;
    }}
  />;
  return <section aria-label={t("settings.themeSelection")}>
    <SettingSection title={t("settings.themeSelection")}>
      <fieldset disabled={themes.isLoading}>
        <SettingRow label={t("settings.themeMode")} description={t("settings.themeModeDesc")}>
          <SettingButtonGroup value={themes.settings.followSystemTheme ? "system" : "static"}
            onChange={(mode) => saveThemeChoice(() => themes.updateSettings({ followSystemTheme: mode === "system" }))}
            options={[{ value: "static", label: t("settings.themeModeStatic") }, { value: "system", label: t("settings.themeModeSystem") }]} />
        </SettingRow>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 border-t border-default py-3">
        <ThemeActionsMenu label={t("themePackages.import")} disabled={themes.isLoading} items={[
          { label: t("themePackages.importJSON"), icon: FileJson, onSelect: () => setDocument({ kind: "tabularis" }) },
          { label: t("themePackages.importVSCode"), icon: FolderOpen, onSelect: () => setDocument({ kind: "vscode" }) },
          { label: t("themePackages.localPackage"), icon: Package, onSelect: () => setLocal(true) },
        ]}><Download size={13} />{t("themePackages.import")}<ChevronDown size={12} /></ThemeActionsMenu>
        <button type="button" onClick={browseThemes} className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-2 text-xs text-muted hover:bg-surface-secondary hover:text-primary transition-colors"><Palette size={13} />{t("themePackages.discover")}</button>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" disabled={themes.isLoading} aria-label={t("themePackages.refresh")} title={t("themePackages.refresh")} onClick={() => { void themes.refreshCatalog().catch((failure) => setError(String(failure))); }} className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-secondary disabled:opacity-40"><RefreshCw size={15} /></button>
          <ThemeActionsMenu label={t("themePackages.manage")} items={[{ label: t("themePackages.recover"), icon: Wrench, onSelect: () => setRecover(true) }]} />
        </div>
      </div>
      {themes.isLoading && <p role="status" className="text-xs text-muted mb-3">{t("themePackages.loading")}</p>}
      {missing.map((id) => <p key={id} role="status" className="text-xs text-accent-warning break-all mb-2">{t("themePackages.missing", { id })}</p>)}
      {themes.catalog.issues.length > 0 && <details className="text-xs text-muted mb-3"><summary>{t("themePackages.catalogIssues")}</summary><ul>{themes.catalog.issues.map((issue, index) => <li key={index}>{issue.location}: {issue.message}</li>)}</ul></details>}
      {error && <p role="alert" className="text-sm text-accent-error mb-3">{error}</p>}
      {themes.settings.followSystemTheme ? <>
        <div className="py-3">
          <p className="text-sm text-muted mb-2">{t("settings.lightTheme")}</p>
          {renderPicker(pickerThemes.filter((theme) => themeRegistry.isLightTheme(theme)), themes.settings.lightThemeId, (id) => themes.updateSettings({ lightThemeId: id }))}
        </div>
        <div className="py-3">
          <p className="text-sm text-muted mb-2">{t("settings.darkTheme")}</p>
          {renderPicker(pickerThemes.filter((theme) => themeRegistry.isDarkTheme(theme)), themes.settings.darkThemeId, (id) => themes.updateSettings({ darkThemeId: id }))}
        </div>
      </> : <div className="py-1">{renderPicker(pickerThemes, themes.currentTheme.id, themes.setTheme)}</div>}
    </SettingSection>
    {document && <ThemeDocumentModal isOpen onClose={() => setDocument(undefined)} {...document} />}
    {action && <ThemeActionDialog key={`${action.kind}:${action.theme.entry.id}`} isOpen action={action} onClose={() => { themes.cancelPreview(); setAction(undefined); }} />}
    {recover && <ThemeRecoveryModal isOpen onClose={() => setRecover(false)} />}
    {local && <LocalThemePackageModal isOpen onClose={() => setLocal(false)} />}
    {exporting && <ThemePackageExportModal isOpen onClose={() => setExporting(undefined)} theme={exporting} />}
  </section>;
}

function ThemeActionDialog({ isOpen, action, onClose }: { isOpen: boolean; action: ThemeAction; onClose: () => void }) {
  const { t } = useTranslation();
  const themes = useTheme();
  const [name, setName] = useState(action.theme.entry.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [committed, setCommitted] = useState(false);
  const { cancelPreview } = themes;
  useEffect(() => cancelPreview, [cancelPreview]);
  const execute = async () => {
    setBusy(true); setError("");
    try {
      if (action.kind === "preview") await action.apply();
      else if (action.kind === "duplicate") await themes.duplicateTheme(action.theme.entry.id, name);
      else if (action.kind === "delete") await themes.deleteCustomTheme(action.theme.entry.id);
      else if (action.kind === "package" && action.theme.entry.origin.kind === "installed") {
        const identity = action.theme.entry.origin.identity;
        const args = { registryKey: identity.registryKey, packageName: identity.packageName };
        if (action.operation === "remove") await invoke("uninstall_theme_package", args);
        else await invoke("set_theme_package_enabled", { ...args, enabled: action.operation === "enable" });
        setCommitted(true);
        try { await themes.refreshCatalog(); }
        catch (failure) { setError(`${t("themePackages.committedRefreshFailed")} ${String(failure)}`); return; }
      }
      setCommitted(true); onClose();
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  };
  const destructive = action.kind === "delete" || (action.kind === "package" && action.operation === "remove");
  const label = t(`themePackages.${action.kind === "delete" ? "remove" : action.kind === "package" ? action.operation === "remove" ? "removePackage" : action.operation : action.kind}`);
  const Icon = destructive ? Trash2 : action.kind === "preview" ? Eye : action.kind === "duplicate" ? Copy : Power;
  return <ThemeDialog isOpen={isOpen} onClose={onClose} busy={busy} title={label} subtitle={action.theme.entry.name} icon={<Icon size={20} />} widthClass={action.kind === "preview" ? "w-[760px]" : "w-[600px]"}
    footer={<>
      <ThemeDialogButton onClick={onClose} disabled={busy}>{t(committed ? "common.close" : "common.cancel")}</ThemeDialogButton>
      <ThemeDialogButton variant={destructive ? "danger" : "primary"} busy={busy} disabled={committed || !name.trim()} icon={<Icon size={16} />} onClick={() => void execute()}>{action.kind === "preview" ? t("themePackages.apply") : label}</ThemeDialogButton>
    </>}>
    <InlineBanner tone={destructive ? "red" : action.kind === "package" ? "amber" : "neutral"} icon={destructive || action.kind === "package" ? <AlertTriangle size={16} /> : <Info size={16} />}>
      <p>{t(action.kind === "preview" ? "themePackages.previewReady" : action.kind === "package" ? "themePackages.packageWarning" : action.kind === "delete" ? "themePackages.deleteWarning" : "themePackages.duplicateHint")}</p>
      {action.kind === "package" && action.theme.entry.origin.kind === "installed" && <p className="mt-2 font-mono break-all">{action.theme.entry.origin.identity.packageName}</p>}
    </InlineBanner>
    {action.kind === "preview" && <ThemeSqlSample contribution={action.theme.entry} />}
    {action.kind === "duplicate" && <label className="block space-y-1.5 text-xs font-medium text-secondary">{t("themePackages.name")}<input data-autofocus value={name} maxLength={128} disabled={busy} onChange={(event) => setName(event.target.value)} className="block w-full bg-base border border-strong rounded-lg px-3 py-2 text-sm font-normal text-primary focus:border-focus focus:outline-none disabled:opacity-50" /></label>}
    {error && <InlineBanner tone="red" role="alert" icon={<AlertTriangle size={16} />}><p className="whitespace-pre-wrap break-words">{error}</p></InlineBanner>}
  </ThemeDialog>;
}
