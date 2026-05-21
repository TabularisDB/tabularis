import { Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { HexColorPicker, HexColorInput } from "react-colorful";
import EmojiPicker, { Theme, EmojiStyle, SuggestionMode, SkinTonePickerLocation, type EmojiClickData } from "emoji-picker-react";
import type { ConnectionAppearance, IconOverride } from "../../../contexts/DatabaseContext";
import type { PluginManifest } from "../../../types/plugins";
import { ALL_ICON_NAMES, getLucideIconComponent, camelToKebab } from "../../../utils/connectionIconPack";
import { getConnectionIcon } from "../../../utils/driverUI";
import { ConnectionIconImage } from "../../ConnectionIconImage";

const PALETTE = [
  "#64748b", "#ef4444", "#f97316", "#f59e0b",
  "#eab308", "#84cc16", "#10b981", "#14b8a6",
  "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899",
];

type IconTab = "default" | "pack" | "emoji" | "image";

interface Props {
  value: ConnectionAppearance;
  onChange: (next: ConnectionAppearance) => void;
  connectionId: string;
  /** Optional driver manifest for the preview row icon fallback */
  driverManifest?: PluginManifest;
  /** Connection name shown in the preview row */
  connectionName?: string;
  /**
   * Called after every successful image upload with the new relative path.
   * The parent uses this to track all session uploads for deferred cleanup.
   */
  onImageUploaded?: (path: string) => void;
}

export function AppearanceSection({
  value,
  onChange,
  connectionId,
  driverManifest,
  connectionName,
  onImageUploaded,
}: Props) {
  const { t } = useTranslation();
  const [customOpen, setCustomOpen] = useState(false);

  // Derive the active tab from the icon type. userTab holds an explicit user
  // choice; it is reset to null whenever the icon type changes externally so
  // that re-opening an edited connection always lands on the right tab.
  const [userTab, setUserTab] = useState<IconTab | null>(null);
  const derivedTab: IconTab =
    value.icon?.type === "pack" ? "pack" :
    value.icon?.type === "emoji" ? "emoji" :
    value.icon?.type === "image" ? "image" : "default";
  const tab = userTab ?? derivedTab;

  const prevIconTypeRef = useRef(value.icon?.type);
  useEffect(() => {
    if (value.icon?.type !== prevIconTypeRef.current) {
      prevIconTypeRef.current = value.icon?.type;
      setUserTab(null);
    }
  }, [value.icon?.type]);

  const [iconSearch, setIconSearch] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  function setAccent(c: string | undefined) {
    const next: ConnectionAppearance = { ...value };
    if (c) next.accentColor = c;
    else delete next.accentColor;
    const isEmpty = !next.accentColor && !next.icon;
    onChange(isEmpty ? {} : next);
  }

  function setIcon(icon: IconOverride | undefined) {
    const next: ConnectionAppearance = { ...value };
    if (icon) next.icon = icon;
    else delete next.icon;
    const isEmpty = !next.accentColor && !next.icon;
    onChange(isEmpty ? {} : next);
  }

  async function pickImage() {
    if (imageBusy) return;
    setImageError(null);
    setImageBusy(true);
    try {
      const picked = await openFileDialog({
        multiple: false,
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }],
      }).catch((e: unknown) => {
        throw new Error(`Failed to open file dialog: ${e}`);
      });
      if (typeof picked !== "string") return;
      let stored: string;
      try {
        stored = await invoke<string>("save_connection_icon", {
          connectionId,
          sourcePath: picked,
        });
      } catch (e) {
        throw new Error(`Failed to save icon: ${e}`);
      }
      // Deletion of the previous image is deferred to the parent (save or cancel).
      // This prevents data loss when the user picks multiple images then cancels.
      onImageUploaded?.(stored);
      setIcon({ type: "image", path: stored });
    } catch (e) {
      console.error("[AppearanceSection] pickImage failed:", e);
      setImageError(String(e));
    } finally {
      setImageBusy(false);
    }
  }

  function removeImage() {
    // Deletion is deferred to the parent (save or cancel).
    setIcon(undefined);
  }

  const previewLabel = connectionName ?? t("connectionAppearance.section");
  const previewConn = { appearance: value };

  return (
    <section className="space-y-3 border-t border-zinc-800/60 pt-4 mt-4">
      <h3 className="text-sm font-medium text-zinc-200">{t("connectionAppearance.section")}</h3>

      {/* Preview row — shows current accent color + icon + connection name */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-zinc-900/40 border border-zinc-800/60">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 text-white"
          style={{ background: value.accentColor ?? "#3f3f46" }}
        >
          {getConnectionIcon(previewConn, driverManifest, 18)}
        </div>
        <div className="text-sm text-zinc-300 truncate">{previewLabel}</div>
      </div>

      <div>
        <label className="block text-xs text-zinc-400 mb-2">
          {t("connectionAppearance.accentColor")}
        </label>
        <div className="flex flex-wrap gap-2 items-center" role="group">
          {PALETTE.map(c => (
            <button
              key={c}
              type="button"
              aria-label={`color swatch ${c}`}
              aria-pressed={value.accentColor === c}
              onClick={() => setAccent(c)}
              className="rounded-full transition-transform hover:scale-110"
              style={{
                background: c,
                width: 24,
                height: 24,
                outline: value.accentColor === c ? "2px solid white" : "1px solid rgba(255,255,255,0.15)",
                outlineOffset: 0,
              }}
            />
          ))}
          <button
            type="button"
            aria-label="custom color"
            aria-expanded={customOpen}
            onClick={() => setCustomOpen(o => !o)}
            className="ml-1 text-zinc-400 hover:text-zinc-100 text-sm"
          >
            {t("connectionAppearance.customColor")}
          </button>
        </div>

        {customOpen && (
          <div className="mt-2 space-y-2">
            <HexColorPicker
              color={value.accentColor ?? "#64748b"}
              onChange={(c) => setAccent(c.toLowerCase())}
              style={{ width: "100%", maxWidth: 220, height: 140 }}
            />
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 text-sm">#</span>
              <HexColorInput
                color={value.accentColor ?? ""}
                onChange={(c) => setAccent(c ? c.toLowerCase() : undefined)}
                placeholder="rrggbb"
                prefixed={false}
                aria-label="custom hex input"
                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm w-28 font-mono"
              />
            </div>
          </div>
        )}

        {value.accentColor && (
          <button
            type="button"
            aria-label="reset color"
            onClick={() => setAccent(undefined)}
            className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 underline"
          >
            {t("connectionAppearance.resetColor")}
          </button>
        )}
      </div>

      <div className="mt-2">
        <label className="block text-xs text-zinc-400 mb-2">
          {t("connectionAppearance.icon")}
        </label>
        <div role="tablist" className="flex gap-1 mb-3 border-b border-zinc-800/60">
          {(["default", "pack", "emoji", "image"] as IconTab[]).map(k => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setUserTab(k)}
              className={`px-3 py-1.5 text-xs ${tab === k ? "text-zinc-100 border-b-2 border-blue-500" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {t(`connectionAppearance.tabs.${k}`)}
            </button>
          ))}
        </div>

        {tab === "default" && (
          <button
            type="button"
            aria-label="reset icon"
            onClick={() => setIcon(undefined)}
            className="text-xs text-zinc-500 hover:text-zinc-300 underline"
          >
            {t("connectionAppearance.resetIcon")}
          </button>
        )}

        {tab === "pack" && (
          <div className="space-y-2">
            <input
              type="text"
              value={iconSearch}
              onChange={e => setIconSearch(e.target.value)}
              placeholder={t("connectionAppearance.iconSearch", { defaultValue: "Search icons…" })}
              aria-label="icon search"
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
            />
            {(() => {
              const q = iconSearch.toLowerCase().trim();
              const all = q === "" ? ALL_ICON_NAMES : ALL_ICON_NAMES.filter(n => n.includes(q));
              const RESULT_LIMIT = 120;
              const shown = all.slice(0, RESULT_LIMIT);
              return (
                <>
                  <div className="grid grid-cols-8 gap-1 max-h-72 overflow-y-auto pr-1">
                    {shown.map(id => {
                      const Cmp = getLucideIconComponent(id);
                      if (!Cmp) return null;
                      const selected = value.icon?.type === "pack" &&
                        (value.icon.id === id || camelToKebab(value.icon.id) === id);
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-label={`pick-${id}`}
                          aria-pressed={selected}
                          onClick={() => setIcon({ type: "pack", id })}
                          className={`flex items-center justify-center p-1.5 rounded transition-colors ${
                            selected ? "bg-blue-500/20 text-blue-300" : "bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300"
                          }`}
                        >
                          <Suspense fallback={<div className="w-[18px] h-[18px]" />}>
                            <Cmp size={18} />
                          </Suspense>
                        </button>
                      );
                    })}
                  </div>
                  {all.length > RESULT_LIMIT && (
                    <div className="text-xs text-zinc-500">
                      {t("connectionAppearance.iconResultsTruncated", {
                        defaultValue: "Showing {{shown}} of {{total}} — refine search to narrow down.",
                        shown: RESULT_LIMIT,
                        total: all.length,
                      })}
                    </div>
                  )}
                  {all.length === 0 && (
                    <div className="text-xs text-zinc-500">
                      {t("connectionAppearance.iconNoResults", { defaultValue: "No icons match." })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {tab === "emoji" && (
          <div className="rounded border border-zinc-800 overflow-hidden">
            <EmojiPicker
              theme={Theme.DARK}
              emojiStyle={EmojiStyle.NATIVE}
              width="100%"
              height={360}
              searchPlaceholder={t("connectionAppearance.emojiSearch", { defaultValue: "Search emoji…" })}
              suggestedEmojisMode={SuggestionMode.RECENT}
              skinTonePickerLocation={SkinTonePickerLocation.SEARCH}
              previewConfig={{ showPreview: false }}
              lazyLoadEmojis
              onEmojiClick={(data: EmojiClickData) => setIcon({ type: "emoji", value: data.emoji })}
            />
          </div>
        )}

        {tab === "image" && (
          <div>
            <button
              type="button"
              aria-label="choose image"
              disabled={imageBusy}
              onClick={pickImage}
              className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded disabled:opacity-50"
            >
              {t("connectionAppearance.chooseImage")}
            </button>
            {value.icon?.type === "image" && (
              <>
                <button
                  type="button"
                  aria-label="remove image"
                  onClick={removeImage}
                  className="ml-2 px-3 py-1.5 text-sm text-rose-300 hover:text-rose-200"
                >
                  {t("connectionAppearance.removeImage")}
                </button>
                <div className="mt-3 inline-block">
                  <ConnectionIconImage
                    path={value.icon.path}
                    size={64}
                    fallback={
                      <div className="w-16 h-16 bg-zinc-800 rounded flex items-center justify-center text-zinc-500 text-xs">
                        {t("connectionAppearance.noPreview", { defaultValue: "No preview" })}
                      </div>
                    }
                  />
                </div>
              </>
            )}
            {imageError && (
              <div role="alert" className="mt-1 text-xs text-rose-400">{imageError}</div>
            )}
            <div className="mt-1 text-xs text-zinc-500">{t("connectionAppearance.imageHint")}</div>
          </div>
        )}
      </div>
    </section>
  );
}
