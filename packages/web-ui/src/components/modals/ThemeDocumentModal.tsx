import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Eye, FileCode, Info, Pencil, Save } from "lucide-react";
import { ThemeDialog } from "../ui/ThemeDialog";
import { ThemeDialogButton } from "../ui/ThemeDialogButton";
import { InlineBanner } from "../ui/InlineBanner";
import { ThemeSqlSample } from "../ui/ThemeSqlSample";
import { Select } from "../ui/Select";
import { useTheme } from "../../hooks/useTheme";
import { convertVsCodeTheme, VsCodeThemeImportError, type VsCodeThemeDiagnostic } from "../../utils/vsCodeThemeImport";
import { resolveCatalogEntry } from "../../utils/themeCatalog";
import type { CatalogTheme, NativeThemeContribution } from "../../types/themeCatalog";
import type { ThemePackageMode } from "../../types/themePackage";

interface ThemeDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  kind: "tabularis" | "vscode" | "edit";
  original?: CatalogTheme;
}

export function ThemeDocumentModal({ isOpen, onClose, kind, original }: ThemeDocumentModalProps) {
  const { t } = useTranslation();
  const themes = useTheme();
  const modeId = useId();
  const [source, setSource] = useState(original?.entry.source ?? "");
  const [editorSource, setEditorSource] = useState(original?.entry.editor ? JSON.stringify(original.entry.editor, null, 2) : "");
  const snapshot = kind === "edit" && original?.entry.format === "legacy" && !!original.entry.editor;
  const [name, setName] = useState(original?.entry.name ?? t("themePackages.importedTheme"));
  const [mode, setMode] = useState<ThemePackageMode | "">("");
  const [prepared, setPrepared] = useState<{ entry: NativeThemeContribution; document: string; diagnostics: VsCodeThemeDiagnostic[] }>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [apply, setApply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const { cancelPreview } = themes;
  useEffect(() => () => { ++generation.current; cancelPreview(); }, [cancelPreview]);
  if (!isOpen) return null;

  const invalidate = () => { ++generation.current; setPrepared(undefined); setAcknowledged(false); setError(""); cancelPreview(); };
  const preview = async () => {
    const request = ++generation.current;
    setBusy(true); setError(""); setPrepared(undefined); setAcknowledged(false); cancelPreview();
    try {
      const converted = kind === "vscode" ? convertVsCodeTheme(source, { mode: mode || undefined }) : undefined;
      const document = snapshot ? JSON.stringify({ themeSnapshotVersion: 1, source, editor: JSON.parse(editorSource) }) : converted ? JSON.stringify(converted.definition) : source;
      const entry = await invoke<NativeThemeContribution>("preview_theme_document", { source: document, name });
      if (request !== generation.current) return;
      themes.previewTheme(entry);
      setPrepared({ entry, document, diagnostics: converted?.diagnostics ?? [] });
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof VsCodeThemeImportError ? t(`themePackages.importErrors.${failure.code}`) : String(failure));
    } finally { if (request === generation.current) setBusy(false); }
  };
  const commit = async () => {
    if (!prepared || committed || (prepared.diagnostics.length > 0 && !acknowledged)) return;
    setBusy(true); setError("");
    try {
      let id: string;
      if (original) {
        id = original.entry.id;
        if (snapshot) await themes.updatePersonalSource(id, name, prepared.entry.source, original.entry.revision, prepared.entry.editor ?? undefined);
        else if (original.entry.format === "v1") await themes.updatePersonalSource(id, name, prepared.entry.source, original.entry.revision);
        else {
          const edited = resolveCatalogEntry(prepared.entry).resolved.theme;
          await themes.updateCustomTheme({ ...edited, id, name });
        }
      } else id = (await themes.importTheme(prepared.document, name)).id;
      // Do not retry creation if subsequent selection persistence fails.
      setCommitted(true);
      cancelPreview();
      if (apply) {
        try { await themes.setTheme(id); }
        catch (failure) { setError(`${t("themePackages.savedNotApplied")} ${String(failure)}`); return; }
      }
      onClose();
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  };
  return <ThemeDialog isOpen onClose={onClose} busy={busy} widthClass="w-[760px]"
    icon={kind === "edit" ? <Pencil size={20} /> : <FileCode size={20} />}
    title={t(`themePackages.${kind === "vscode" ? "importVSCode" : kind === "edit" ? "edit" : "importJSON"}`)}
    subtitle={original?.entry.name}
    footer={<>
      <ThemeDialogButton className="mr-auto" icon={<Eye size={16} />} onClick={() => void preview()} disabled={busy || committed || !source || !name.trim()}>{t("themePackages.preview")}</ThemeDialogButton>
      <ThemeDialogButton disabled={busy} onClick={onClose}>{t(committed ? "common.close" : "common.cancel")}</ThemeDialogButton>
      <ThemeDialogButton variant="primary" icon={<Save size={16} />} disabled={busy || committed || !prepared || (prepared.diagnostics.length > 0 && !acknowledged)} onClick={() => void commit()}>{t("common.save")}</ThemeDialogButton>
    </>}>
    <p className="text-sm leading-relaxed text-secondary">{t("themePackages.previewHint")}</p>
    {kind === "vscode" && <InlineBanner tone="neutral" icon={<Info size={16} />}>{t("themePackages.licenseNotice")}</InlineBanner>}
    <fieldset disabled={busy || committed} className="space-y-4">
      {kind !== "edit" && <label className="block space-y-1.5 text-xs font-medium text-secondary">{t("themePackages.file")}<input type="file" accept={kind === "vscode" ? ".json,.jsonc" : ".json"} className="block w-full min-w-0 rounded-lg border border-strong bg-base p-2 text-sm font-normal text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-surface-secondary file:px-3 file:py-1.5 file:text-primary file:cursor-pointer focus-visible:outline focus-visible:outline-focus disabled:opacity-50" onChange={async (event) => {
        const file = event.target.files?.[0]; if (!file) return;
        invalidate(); const request = generation.current;
        const limit = kind === "vscode" ? 256 * 1024 : 8 * 1024 * 1024;
        if (file.size > limit) { setError(t("themePackages.fileTooLarge")); return; }
        try { const text = await file.text(); if (request === generation.current) setSource(text); }
        catch (failure) { if (request === generation.current) setError(String(failure)); }
      }} /></label>}
      <label className="block space-y-1.5 text-xs font-medium text-secondary">{t("themePackages.name")}<input data-autofocus value={name} maxLength={128} onChange={(event) => { invalidate(); setName(event.target.value); }} className="block w-full px-3 py-2 bg-base border border-strong rounded-lg text-sm font-normal text-primary focus:border-focus focus:outline-none disabled:opacity-50" /></label>
      {kind === "vscode" && <div className="space-y-1.5">
        <label htmlFor={modeId} className="block text-xs font-medium text-secondary">{t("themePackages.mode")}</label>
        <Select id={modeId} value={mode || "auto"} options={["auto", "light", "dark", "high-contrast"]}
          labels={{ auto: t("themePackages.detectMode"), light: t("themePackages.modes.light"), dark: t("themePackages.modes.dark"), "high-contrast": t("themePackages.modes.high-contrast") }}
          searchable={false} disabled={busy || committed}
          onChange={(value) => { invalidate(); setMode(value === "auto" ? "" : value as ThemePackageMode); }} />
      </div>}
      <label className="block space-y-1.5 text-xs font-medium text-secondary">{t("themePackages.source")}<textarea spellCheck={false} value={source} maxLength={8 * 1024 * 1024} onChange={(event) => { invalidate(); setSource(event.target.value); }} rows={10} className="block w-full resize-none font-mono font-normal text-xs leading-relaxed p-3 bg-base border border-strong rounded-lg text-primary focus:border-focus focus:outline-none disabled:opacity-50" /></label>
      {snapshot && <label className="block space-y-1.5 text-xs font-medium text-secondary">{t("themePackages.snapshotEditor")}<textarea aria-label={t("themePackages.snapshotEditor")} spellCheck={false} value={editorSource} onChange={(event) => { invalidate(); setEditorSource(event.target.value); }} maxLength={4 * 1024 * 1024} rows={8} className="block w-full resize-none font-mono font-normal text-xs leading-relaxed p-3 bg-base border border-strong rounded-lg text-primary focus:border-focus focus:outline-none disabled:opacity-50" /><span className="block font-normal leading-relaxed text-muted">{t("themePackages.snapshotEditorHelp")}</span></label>}
      {prepared && <div role="status" className="text-sm text-secondary">{t("themePackages.previewReady")}</div>}
      {!!prepared?.diagnostics.length && <div className="space-y-2">
        <ul className="text-xs max-h-40 overflow-y-auto rounded-lg border border-strong bg-base p-3 space-y-1 break-words">{prepared.diagnostics.map((diagnostic, index) => <li key={index}>{t(`themePackages.diagnostics.${diagnostic.code}`)}: <code>{diagnostic.path}</code></li>)}</ul>
        <label className="flex items-start gap-2 text-sm text-secondary"><input className="mt-1 shrink-0 accent-accent-primary" type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />{t("themePackages.acknowledge")}</label>
      </div>}
      <label className="flex items-start gap-2 text-sm text-secondary"><input className="mt-1 shrink-0 accent-accent-primary" type="checkbox" checked={apply} onChange={(event) => setApply(event.target.checked)} />{t("themePackages.applyAfterSave")}</label>
    </fieldset>
    {prepared && !committed && <ThemeSqlSample contribution={prepared.entry} />}
    {error && <InlineBanner tone="red" role="alert" icon={<AlertTriangle size={16} />}><p className="whitespace-pre-wrap break-words">{error}</p></InlineBanner>}
  </ThemeDialog>;
}
