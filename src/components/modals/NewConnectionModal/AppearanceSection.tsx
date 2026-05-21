import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { EmojiPicker } from "frimousse";
import type { ConnectionAppearance, IconOverride } from "../../../contexts/DatabaseContext";
import type { PluginManifest } from "../../../types/plugins";
import { CONNECTION_ICON_PACK } from "../../../utils/connectionIconPack";
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
}

export function AppearanceSection({
  value,
  onChange,
  connectionId,
  driverManifest,
  connectionName,
}: Props) {
  const { t } = useTranslation();
  const [customOpen, setCustomOpen] = useState(false);

  // Approach B: derive tab from value.icon, allow user to override
  // userTab is null until the user explicitly clicks a tab; if null we derive
  // from the current icon type so re-opening an edited connection shows the
  // correct tab immediately.
  const [userTab, setUserTab] = useState<IconTab | null>(null);
  const derivedTab: IconTab =
    value.icon?.type === "pack" ? "pack" :
    value.icon?.type === "emoji" ? "emoji" :
    value.icon?.type === "image" ? "image" : "default";
  const tab = userTab ?? derivedTab;

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
    const previousImagePath = value.icon?.type === "image" ? value.icon.path : null;
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
      if (previousImagePath && previousImagePath !== stored) {
        invoke("delete_connection_icon", { relativePath: previousImagePath }).catch(() => {});
      }
      setIcon({ type: "image", path: stored });
    } catch (e) {
      console.error("[AppearanceSection] pickImage failed:", e);
      setImageError(String(e));
    } finally {
      setImageBusy(false);
    }
  }

  async function removeImage() {
    if (value.icon?.type === "image") {
      try { await invoke("delete_connection_icon", { relativePath: value.icon.path }); }
      catch { /* swallow — file may already be gone */ }
    }
    setIcon(undefined);
  }

  const previewLabel = connectionName ?? t("connectionAppearance.section");
  // Build a minimal connection-like object for getConnectionIcon
  const previewConn = { appearance: value };

  const filteredPackIcons = Object.entries(CONNECTION_ICON_PACK).filter(
    ([id]) => id.toLowerCase().includes(iconSearch.toLowerCase().trim()),
  );

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
              placeholder="Search icons…"
              aria-label="icon search"
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
            />
            <div className="grid grid-cols-6 gap-2">
              {filteredPackIcons.map(([id, Cmp]) => (
                <button
                  key={id}
                  type="button"
                  aria-label={`pick-${id}`}
                  aria-pressed={value.icon?.type === "pack" && value.icon.id === id}
                  onClick={() => setIcon({ type: "pack", id })}
                  className={`flex items-center justify-center p-2 rounded transition-colors ${
                    value.icon?.type === "pack" && value.icon.id === id
                      ? "bg-blue-500/20 text-blue-300"
                      : "bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300"
                  }`}
                >
                  <Cmp size={18} />
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "emoji" && (
          <EmojiPicker.Root
            onEmojiSelect={(emoji: { emoji: string }) =>
              setIcon({ type: "emoji", value: emoji.emoji })
            }
            className="w-full"
          >
            <EmojiPicker.Search
              placeholder="Search emoji…"
              aria-label="emoji search"
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500 mb-2"
            />
            <EmojiPicker.Viewport className="max-h-72 overflow-y-auto rounded bg-zinc-900 border border-zinc-800">
              <EmojiPicker.Loading className="p-4 text-xs text-zinc-500 text-center">
                Loading…
              </EmojiPicker.Loading>
              <EmojiPicker.Empty className="p-4 text-xs text-zinc-500 text-center">
                No emoji found
              </EmojiPicker.Empty>
              <EmojiPicker.List
                className="[--emoji-picker-list-padding:8px] [--emoji-picker-list-gap:4px]"
              />
            </EmojiPicker.Viewport>
          </EmojiPicker.Root>
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
              <button
                type="button"
                aria-label="remove image"
                onClick={removeImage}
                className="ml-2 px-3 py-1.5 text-sm text-rose-300 hover:text-rose-200"
              >
                {t("connectionAppearance.removeImage")}
              </button>
            )}
            {value.icon?.type === "image" && (
              <div className="mt-3 inline-block">
                <ConnectionIconImage
                  path={value.icon.path}
                  size={64}
                  fallback={
                    <div className="w-16 h-16 bg-zinc-800 rounded flex items-center justify-center text-zinc-500 text-xs">
                      No preview
                    </div>
                  }
                />
              </div>
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
