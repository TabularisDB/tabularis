import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, Loader2, X } from "lucide-react";
import clsx from "clsx";

import { formatEvent } from "../../utils/keybindings";
import type { KeyMatch } from "../../utils/keybindings";

interface ShortcutsEditModalProps {
  label: string;
  current: string;
  isMac: boolean;
  onClose: () => void;
  onSave: (match: KeyMatch) => Promise<void>;
}

interface RecordedShortcut {
  display: string;
  match: KeyMatch;
}

const TEXT_COMPOSITION_KEYS = new Set([
  "Dead",
  "Process",
  "Unidentified",
  "Compose",
]);

export function ShortcutsEditModal({
  label,
  current,
  isMac,
  onClose,
  onSave,
}: ShortcutsEditModalProps) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState<RecordedShortcut | null>(null);
  const [needsModifier, setNeedsModifier] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return;

      // Alt alone still produces a character (AltGr on Windows, Option on
      // macOS), so accept it only with a non-text key. Cmd is macOS-only;
      // Ctrl without Alt is safe on either platform.
      const modifierHeld =
        event.ctrlKey || event.altKey || (isMac && event.metaKey);
      const primaryModifierHeld =
        (isMac && event.metaKey) || (event.ctrlKey && !event.altKey);
      const producesText =
        event.key.length === 1 || TEXT_COMPOSITION_KEYS.has(event.key);
      const safeCombo =
        primaryModifierHeld || (modifierHeld && !producesText);
      if (!safeCombo) {
        setRecording(null);
        setNeedsModifier(true);
        return;
      }

      setNeedsModifier(false);
      setRecording({
        display: formatEvent(event.nativeEvent, isMac),
        match: {
          key: producesText ? event.key.toLowerCase() : event.key,
          code: event.code,
          ...(event.ctrlKey ? { ctrlKey: true } : {}),
          ...(event.metaKey ? { metaKey: true } : {}),
          ...(event.shiftKey ? { shiftKey: true } : {}),
          ...(event.altKey ? { altKey: true } : {}),
        },
      });
    },
    [isMac, onClose],
  );

  const handleSave = async () => {
    if (!recording) return;
    setSaving(true);
    try {
      await onSave(recording.match);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-edit-title"
        className="bg-elevated border border-default rounded-2xl shadow-2xl w-full max-w-md p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/15 rounded-lg">
              <Keyboard size={18} className="text-blue-400" />
            </div>
            <div>
              <h3
                id="shortcut-edit-title"
                className="text-base font-semibold text-primary"
              >
                {label}
              </h3>
              <p className="text-xs text-muted mt-0.5">{current}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-secondary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <button
          type="button"
          aria-label={t("settings.shortcuts.pressKeys")}
          className={clsx(
            "flex items-center justify-center h-24 w-full rounded-xl border-2 text-sm font-mono cursor-default select-none transition-colors",
            recording
              ? "border-blue-500 bg-blue-500/10 text-blue-300"
              : "border-dashed border-default text-muted",
          )}
          autoFocus
          onKeyDown={handleKeyDown}
        >
          {recording ? (
            <kbd className="text-2xl font-semibold tracking-wide">
              {recording.display}
            </kbd>
          ) : (
            <span className="text-sm">
              {t("settings.shortcuts.pressKeys")}
            </span>
          )}
        </button>

        {needsModifier ? (
          <p role="alert" className="text-xs text-center mt-2 text-red-400">
            {t("settings.shortcuts.needsModifier")}
          </p>
        ) : (
          <p className="text-xs text-muted text-center mt-2">
            {recording
              ? t("common.save") + " / Esc"
              : "Esc " + t("common.cancel")}
          </p>
        )}

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm border border-default text-muted hover:text-primary hover:border-blue-500/50 transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!recording || saving}
            className="flex-1 px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
