import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, Lock, RotateCcw } from "lucide-react";
import { useKeybindings } from "../../hooks/useKeybindings";
import { useAlert } from "../../hooks/useAlert";
import {
  formatMatch,
  keyMatchesOverlap,
  matchesReservedShortcut,
  shortcutCategoriesOverlap,
} from "../../utils/keybindings";
import type { KeyMatch } from "../../utils/keybindings";
import { ShortcutsEditModal } from "./ShortcutsEditModal";
import { SettingSection } from "./SettingControls";

/* ── Edit modal ── */

interface EditingShortcut {
  id: string;
  label: string;
  current: string;
}

/* ── Main tab ── */

export function ShortcutsTab() {
  const { t } = useTranslation();
  const { showAlert } = useAlert();
  const { shortcuts, saveOverride, resetOverride, overrides, isMac } =
    useKeybindings();
  const [editingShortcut, setEditingShortcut] =
    useState<EditingShortcut | null>(null);
  const categories = [
    "editor",
    "navigation",
    "data_grid",
    "notebook",
  ] as const;

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
    async (match: KeyMatch) => {
      if (!editingShortcut) return;
      const editedShortcut = shortcuts.find(
        (shortcut) => shortcut.id === editingShortcut.id,
      );
      if (!editedShortcut) return;
      const conflict = shortcuts.find(
        (shortcut) =>
          shortcut.id !== editingShortcut.id &&
          shortcutCategoriesOverlap(
            editedShortcut.category,
            shortcut.category,
          ) &&
          (keyMatchesOverlap(match, shortcut.match, isMac) ||
            matchesReservedShortcut(shortcut.id, match, isMac)),
      );
      if (conflict) {
        showAlert(
          t("settings.shortcuts.conflict", {
            shortcut: t(conflict.i18nKey as Parameters<typeof t>[0]),
          }),
          { title: t("common.error"), kind: "error" },
        );
        return;
      }

      if (isMac) {
        await saveOverride(
          editingShortcut.id,
          match,
          overrides[editingShortcut.id]?.win ?? editedShortcut.winMatch,
        );
      } else {
        await saveOverride(
          editingShortcut.id,
          overrides[editingShortcut.id]?.mac ?? editedShortcut.macMatch,
          match,
        );
      }
      setEditingShortcut(null);
    },
    [
      editingShortcut,
      isMac,
      saveOverride,
      overrides,
      shortcuts,
      showAlert,
      t,
    ],
  );

  return (
    <>
      {editingShortcut && (
        <ShortcutsEditModal
          label={editingShortcut.label}
          current={editingShortcut.current}
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
