import { Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { HexColorPicker, HexColorInput } from "react-colorful";
import EmojiPicker, { Theme, EmojiStyle, SuggestionMode, SkinTonePickerLocation, type EmojiClickData } from "emoji-picker-react";
import clsx from "clsx";
import { Check, Sparkles, Grid3x3, Smile, Image as ImageIcon, Pipette, Upload, Trash2 } from "lucide-react";
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

const TAB_ICONS: Record<IconTab, typeof Sparkles> = {
  default: Sparkles,
  pack: Grid3x3,
  emoji: Smile,
  image: ImageIcon,
};

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

  const accent = value.accentColor ?? "#3f3f46";

  return (
    <div className="space-y-5">
      {/* Preview row — shows current accent color + icon + connection name */}
      <div className="relative overflow-hidden rounded-lg border border-default bg-base">
        {value.accentColor && (
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none opacity-25"
            style={{
              background: `linear-gradient(135deg, ${value.accentColor} 0%, transparent 65%)`,
            }}
          />
        )}
        <div className="relative flex items-center gap-3 px-3.5 py-3">
          <div
            className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0 text-white shadow-md ring-1 ring-black/10"
            style={{ background: accent }}
          >
            {getConnectionIcon(previewConn, driverManifest, 22)}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[9px] uppercase font-semibold tracking-widest text-muted">
              {t("connectionAppearance.previewLabel", { defaultValue: "Preview" })}
            </span>
            <span className="text-sm font-medium text-primary truncate">{previewLabel}</span>
          </div>
        </div>
      </div>

      {/* Accent color */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
            {t("connectionAppearance.accentColor")}
          </label>
          {value.accentColor && (
            <button
              type="button"
              aria-label="reset color"
              onClick={() => setAccent(undefined)}
              className="text-xs text-muted hover:text-primary transition-colors"
            >
              {t("connectionAppearance.resetColor")}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center" role="group">
          {PALETTE.map(c => {
            const selected = value.accentColor === c;
            return (
              <button
                key={c}
                type="button"
                aria-label={`color swatch ${c}`}
                aria-pressed={selected}
                onClick={() => setAccent(c)}
                className={clsx(
                  "relative w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150",
                  "shadow-[inset_0_-1px_0_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.18)]",
                  selected
                    ? "scale-110 ring-2 ring-white/95 ring-offset-2 ring-offset-elevated"
                    : "ring-1 ring-white/10 hover:scale-110 hover:ring-white/30",
                )}
                style={{ background: c }}
              >
                {selected && (
                  <Check size={14} strokeWidth={3} className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]" />
                )}
              </button>
            );
          })}
          <button
            type="button"
            aria-label="custom color"
            aria-expanded={customOpen}
            onClick={() => setCustomOpen(o => !o)}
            className={clsx(
              "ml-1 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors",
              customOpen
                ? "bg-blue-500/15 border-blue-500/40 text-blue-400"
                : "bg-elevated border-strong text-secondary hover:text-primary hover:bg-surface-secondary",
            )}
          >
            <Pipette size={12} />
            <span>{t("connectionAppearance.customColor")}</span>
          </button>
        </div>

        {customOpen && (
          <div className="space-y-3 p-3 rounded-md border border-default bg-base">
            <HexColorPicker
              color={value.accentColor ?? "#64748b"}
              onChange={(c) => setAccent(c.toLowerCase())}
              style={{ width: "100%", maxWidth: 240, height: 150 }}
            />
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-md shrink-0 ring-1 ring-white/10 shadow-inner"
                style={{ background: value.accentColor ?? "#64748b" }}
              />
              <span className="text-muted text-sm font-mono">#</span>
              <HexColorInput
                color={value.accentColor ?? ""}
                onChange={(c) => setAccent(c ? c.toLowerCase() : undefined)}
                placeholder="rrggbb"
                prefixed={false}
                aria-label="custom hex input"
                className="px-3 py-1.5 bg-elevated border border-strong rounded-md text-sm text-primary placeholder:text-muted placeholder:italic focus:border-blue-500 focus:outline-none transition-colors font-mono w-28 uppercase"
              />
            </div>
          </div>
        )}
      </div>

      {/* Icon */}
      <div className="flex flex-col gap-2.5">
        <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
          {t("connectionAppearance.icon")}
        </label>

        <div role="tablist" className="inline-flex rounded-md border border-strong overflow-hidden w-fit bg-elevated">
          {(["default", "pack", "emoji", "image"] as IconTab[]).map(k => {
            const TabIcon = TAB_ICONS[k];
            const isActive = tab === k;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setUserTab(k);
                  // Switching to "default" is the act of clearing the override.
                  if (k === "default" && value.icon) setIcon(undefined);
                }}
                className={clsx(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-secondary hover:text-primary hover:bg-surface-secondary",
                )}
              >
                <TabIcon size={13} />
                <span>{t(`connectionAppearance.tabs.${k}`)}</span>
              </button>
            );
          })}
        </div>

        {tab === "default" && (
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-md border border-dashed border-default bg-base">
            <Sparkles size={14} className="text-muted shrink-0" />
            <p className="text-xs text-muted">
              {t("connectionAppearance.defaultHint", {
                defaultValue: "Using the driver's default icon.",
              })}
            </p>
          </div>
        )}

        {tab === "pack" && (
          <div className="space-y-2">
            <input
              type="text"
              value={iconSearch}
              onChange={e => setIconSearch(e.target.value)}
              placeholder={t("connectionAppearance.iconSearch", { defaultValue: "Search icons…" })}
              aria-label="icon search"
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted placeholder:italic focus:border-blue-500 focus:outline-none transition-colors"
            />
            {(() => {
              const q = iconSearch.toLowerCase().trim();
              const all = q === "" ? ALL_ICON_NAMES : ALL_ICON_NAMES.filter(n => n.includes(q));
              const RESULT_LIMIT = 120;
              const shown = all.slice(0, RESULT_LIMIT);
              return (
                <>
                  <div className="grid grid-cols-8 gap-1.5 max-h-72 overflow-y-auto pr-1 p-2 rounded-md border border-default bg-base">
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
                          title={id}
                          onClick={() => setIcon({ type: "pack", id })}
                          className={clsx(
                            "aspect-square flex items-center justify-center rounded-md transition-all",
                            selected
                              ? "bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/50 shadow-[0_0_0_2px_rgba(59,130,246,0.15)]"
                              : "text-secondary hover:bg-surface-secondary hover:text-primary",
                          )}
                        >
                          <Suspense fallback={<div className="w-[18px] h-[18px]" />}>
                            <Cmp size={18} />
                          </Suspense>
                        </button>
                      );
                    })}
                  </div>
                  {all.length > RESULT_LIMIT && (
                    <div className="text-xs text-muted">
                      {t("connectionAppearance.iconResultsTruncated", {
                        defaultValue: "Showing {{shown}} of {{total}} — refine search to narrow down.",
                        shown: RESULT_LIMIT,
                        total: all.length,
                      })}
                    </div>
                  )}
                  {all.length === 0 && (
                    <div className="text-xs text-muted">
                      {t("connectionAppearance.iconNoResults", { defaultValue: "No icons match." })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {tab === "emoji" && (
          <div className="space-y-2">
            {value.icon?.type === "emoji" && (
              <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-default bg-base">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-md bg-elevated border border-strong flex items-center justify-center text-2xl leading-none shrink-0">
                    {value.icon.value}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[9px] uppercase font-semibold tracking-widest text-muted">
                      {t("connectionAppearance.emojiSelected", { defaultValue: "Selected emoji" })}
                    </span>
                    <span className="text-xs text-secondary truncate">
                      {t("connectionAppearance.emojiHint", {
                        defaultValue: "Click another emoji below to change.",
                      })}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="clear emoji"
                  onClick={() => setIcon(undefined)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors shrink-0"
                >
                  <Trash2 size={12} />
                  <span>{t("connectionAppearance.removeEmoji", { defaultValue: "Clear" })}</span>
                </button>
              </div>
            )}
            <div className="rounded-md border border-default overflow-hidden shadow-sm emoji-picker-wrap">
              <EmojiPicker
                theme={Theme.DARK}
                emojiStyle={EmojiStyle.NATIVE}
                width="100%"
                height={340}
                searchPlaceholder={t("connectionAppearance.emojiSearch", { defaultValue: "Search emoji…" })}
                suggestedEmojisMode={SuggestionMode.RECENT}
                skinTonePickerLocation={SkinTonePickerLocation.SEARCH}
                previewConfig={{ showPreview: false }}
                lazyLoadEmojis
                onEmojiClick={(data: EmojiClickData) => setIcon({ type: "emoji", value: data.emoji })}
              />
            </div>
          </div>
        )}

        {tab === "image" && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-md border border-default bg-base">
              {value.icon?.type === "image" ? (
                <ConnectionIconImage
                  path={value.icon.path}
                  size={64}
                  fallback={
                    <div className="w-16 h-16 bg-elevated border border-strong rounded-md flex items-center justify-center text-muted text-[10px] text-center px-1">
                      {t("connectionAppearance.noPreview", { defaultValue: "No preview" })}
                    </div>
                  }
                />
              ) : (
                <div className="w-16 h-16 bg-elevated border border-dashed border-strong rounded-md flex items-center justify-center text-muted shrink-0">
                  <ImageIcon size={22} />
                </div>
              )}
              <div className="flex-1 flex flex-col gap-2 min-w-0">
                <p className="text-xs text-muted leading-snug">
                  {t("connectionAppearance.imageHint")}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    aria-label="choose image"
                    disabled={imageBusy}
                    onClick={pickImage}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-elevated hover:bg-surface-secondary border border-strong rounded-md text-xs font-medium text-secondary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Upload size={12} />
                    <span>{t("connectionAppearance.chooseImage")}</span>
                  </button>
                  {value.icon?.type === "image" && (
                    <button
                      type="button"
                      aria-label="remove image"
                      onClick={removeImage}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-md transition-colors"
                    >
                      <Trash2 size={12} />
                      <span>{t("connectionAppearance.removeImage")}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
            {imageError && (
              <div role="alert" className="text-xs text-rose-400 flex items-center gap-1">
                {imageError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
