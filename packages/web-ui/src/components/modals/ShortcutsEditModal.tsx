import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, Loader2, X } from "lucide-react";
import clsx from "clsx";

import { formatEvent } from "../../utils/keybindings";
import type { KeyMatch } from "../../utils/keybindings";
import { isTextCompositionKeyEvent } from "../../utils/keyboardEvents";

interface ShortcutsEditModalProps {
  isOpen: boolean;
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

export function ShortcutsEditModal({
  isOpen,
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
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleDialogKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") return;
      if (
        event.key === "Tab" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return;
      if (isTextCompositionKeyEvent(event.nativeEvent)) {
        setRecording(null);
        setNeedsModifier(true);
        return;
      }

      // Alt alone still produces a character (AltGr on Windows, Option on
      // macOS), so accept it only with a non-text key. Cmd is macOS-only;
      // Ctrl without Alt is safe on either platform.
      const modifierHeld =
        event.ctrlKey || event.altKey || (isMac && event.metaKey);
      const primaryModifierHeld =
        (isMac && event.metaKey) || (event.ctrlKey && !event.altKey);
      const producesText = event.key.length === 1;
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
    [isMac],
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

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm"
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape and the Tab focus trap belong on the dialog; the plugin only exempts the <dialog> element, not role="dialog" */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-edit-title"
        onKeyDown={handleDialogKeyDown}
        className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent-primary/15 rounded-lg">
              <Keyboard size={18} className="text-accent" />
            </div>
            <div>
              <h2
                id="shortcut-edit-title"
                className="text-lg font-semibold text-primary"
              >
                {label}
              </h2>
              <p className="text-xs text-secondary">{current}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-2 bg-surface-secondary text-secondary hover:text-primary rounded transition-all"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          <button
            type="button"
            aria-label={t("settings.shortcuts.pressKeys")}
            className={clsx(
              "flex items-center justify-center h-24 w-full rounded-xl border-2 text-sm font-mono cursor-default select-none transition-colors",
              recording
                ? "border-accent-primary bg-accent-primary/10 text-accent"
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
            <p role="alert" className="text-xs text-center text-error-text">
              {t("settings.shortcuts.needsModifier")}
            </p>
          ) : null}
        </div>

        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!recording || saving}
            className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-inverse rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
