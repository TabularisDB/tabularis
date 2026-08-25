import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, Lock, RotateCcw, Loader2, X } from "lucide-react";
import clsx from "clsx";
import { useKeybindings } from "../../hooks/useKeybindings";
import { formatEvent, formatMatch, parseCombo } from "../../utils/keybindings";
import { SettingSection } from "./SettingControls";

/* ── Edit modal ── */

interface EditingShortcut {
  id: string;
  label: string;
  current: string;
}

function ShortcutsEditModal({
  editing,
  onClose,
  onSave,
  isMac,
}: {
  editing: EditingShortcut;
  onClose: () => void;
  onSave: (combo: string) => Promise<void>;
  isMac: boolean;
}) {
  const { t } = useTranslation();
  const [combo, setCombo] = useState("");
  const [saving, setSaving] = useState(false);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return;
      setCombo(formatEvent(e.nativeEvent, isMac));
    },
    [isMac, onClose],
  );

  const handleSave = async () => {
    if (!combo) return;
    setSaving(true);
    try {
      await onSave(combo);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-elevated border border-default rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/15 rounded-lg">
              <Keyboard size={18} className="text-blue-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-primary">
                {editing.label}
              </h3>
              <p className="text-xs text-muted mt-0.5">{editing.current}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-secondary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className={clsx(
            "flex items-center justify-center h-24 rounded-xl border-2 text-sm font-mono cursor-default select-none transition-colors",
            combo
              ? "border-blue-500 bg-blue-500/10 text-blue-300"
              : "border-dashed border-default text-muted",
          )}
          tabIndex={0}
          autoFocus
          onKeyDown={handleKeyDown}
        >
          {combo ? (
            <kbd className="text-2xl font-semibold tracking-wide">
              {combo}
            </kbd>
          ) : (
            <span className="text-sm">
              {t("settings.shortcuts.pressKeys")}
            </span>
          )}
        </div>

        <p className="text-xs text-muted text-center mt-2">
          {combo
            ? t("common.save") + " / Esc"
            : "Esc " + t("common.cancel")}
        </p>

        <div className="flex gap-3 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm border border-default text-muted hover:text-primary hover:border-blue-500/50 transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={!combo || saving}
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

/* ── Main tab ── */

export function ShortcutsTab() {
  const { t } = useTranslation();
  const { shortcuts, saveOverride, resetOverride, overrides, isMac } =
    useKeybindings();
  const [editingShortcut, setEditingShortcut] =
    useState<EditingShortcut | null>(null);

  const categories = ["editor", "navigation", "data_grid"] as const;

  const openEdit = useCallback(
    (s: (typeof shortcuts)[number]) => {
      const hasOverride = !!overrides[s.id];
      setEditingShortcut({
        id: s.id,
        label: t(s.i18nKey as Parameters<typeof t>[0]),
        current: isMac
          ? hasOverride
            ? formatMatch(overrides[s.id].mac, true)
            : s.defaultMac
          : hasOverride
            ? formatMatch(overrides[s.id].win, false)
            : s.defaultWin,
      });
    },
    [t, overrides, isMac],
  );

  const handleSave = useCallback(
    async (combo: string) => {
      if (!editingShortcut) return;
      const match = parseCombo(
        combo.replace("\u2318", "Meta").replace("\u2325", "Alt"),
      );
      if (isMac) {
        await saveOverride(
          editingShortcut.id,
          match,
          overrides[editingShortcut.id]?.win ?? match,
        );
      } else {
        await saveOverride(
          editingShortcut.id,
          overrides[editingShortcut.id]?.mac ?? match,
          match,
        );
      }
      setEditingShortcut(null);
    },
    [editingShortcut, isMac, saveOverride, overrides],
  );

  return (
    <>
      {editingShortcut && (
        <ShortcutsEditModal
          editing={editingShortcut}
          onClose={() => setEditingShortcut(null)}
          onSave={handleSave}
          isMac={isMac}
        />
      )}

      <SettingSection
        title={t("settings.shortcuts.title")}
        icon={<Keyboard size={14} className="text-muted" />}
        description={
          isMac
            ? "Use \u2318 (Cmd) as the main modifier. Shortcuts with a lock icon are built-in and cannot be changed."
            : "Use Ctrl as the main modifier. Shortcuts with a lock icon are built-in and cannot be changed."
        }
      >
        <div className="space-y-4 pt-3">
        {categories.map((cat) => {
          const items = shortcuts.filter((s) => s.category === cat);
          if (!items.length) return null;
          return (
            <div
              key={cat}
              className="bg-elevated border border-default rounded-xl overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-default bg-surface-secondary/20">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-widest">
                  {t(
                    `settings.shortcuts.categories.${cat}` as Parameters<typeof t>[0],
                  )}
                </h3>
              </div>
              <div className="divide-y divide-default">
                {items.map((s) => {
                  const hasOverride = !!overrides[s.id];
                  const label = isMac
                    ? hasOverride
                      ? formatMatch(overrides[s.id].mac, true)
                      : s.defaultMac
                    : hasOverride
                      ? formatMatch(overrides[s.id].win, false)
                      : s.defaultWin;
                  return (
                    <div
                      key={s.id}
                      className="flex items-center px-5 py-3.5 gap-4 hover:bg-surface-secondary/20 transition-colors"
                    >
                      <div className="shrink-0">
                        {s.overridable ? (
                          <Keyboard size={14} className="text-blue-400" />
                        ) : (
                          <span
                            title={t("settings.shortcuts.notOverridable")}
                          >
                            <Lock size={14} className="text-muted/50" />
                          </span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-primary">
                          {t(s.i18nKey as Parameters<typeof t>[0])}
                        </span>
                        {hasOverride && (
                          <span className="ml-2 text-xs text-blue-400 font-medium">
                            customized
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {s.overridable ? (
                          <>
                            <button
                              onClick={() => openEdit(s)}
                              className="px-2.5 py-1 text-xs rounded-lg border border-default text-muted hover:text-primary hover:border-blue-500/60 hover:bg-blue-500/5 transition-colors"
                            >
                              {t("common.edit")}
                            </button>
                            {hasOverride && (
                              <button
                                onClick={() => resetOverride(s.id)}
                                title={t(
                                  "settings.shortcuts.resetToDefault",
                                )}
                                className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-secondary transition-colors"
                              >
                                <RotateCcw size={13} />
                              </button>
                            )}
                          </>
                        ) : null}

                        <kbd className="px-2.5 py-1 text-xs font-mono bg-surface-secondary border border-default rounded-lg text-secondary min-w-[100px] text-center">
                          {label}
                        </kbd>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </SettingSection>
    </>
  );
}
