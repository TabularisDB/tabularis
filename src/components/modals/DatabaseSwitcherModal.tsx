import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Check,
  Database,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useDatabase } from "../../hooks/useDatabase";
import { isMultiDatabaseCapable } from "../../utils/database";
import { fuzzyFilter } from "../../utils/fuzzy";
import { toErrorMessage } from "../../utils/errors";

interface DatabaseSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Quick database switcher (Ctrl/Cmd+K): lists every database on the server,
 * filters as you type, and jumps to the picked one — adding it to the
 * sidebar selection when it is not part of it yet.
 *
 * Only rendered for multi-database-capable drivers (see
 * `isMultiDatabaseCapable`); schema-based, single-database and file-based
 * drivers have nothing to switch.
 */
export const DatabaseSwitcherModal = ({
  isOpen,
  onClose,
}: DatabaseSwitcherModalProps) => {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  const {
    activeConnectionId,
    activeCapabilities,
    activeSchema,
    selectedDatabases,
    setSelectedDatabases,
    setActiveTable,
  } = useDatabase();

  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allDatabases, setAllDatabases] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDatabases = useCallback(async () => {
    if (!activeConnectionId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const all = await invoke<string[]>("get_available_databases", {
        connectionId: activeConnectionId,
      });
      setAllDatabases([...all].sort((a, b) => a.localeCompare(b)));
    } catch (err) {
      setLoadError(toErrorMessage(err));
      setAllDatabases(null);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnectionId]);

  const canSwitch = isMultiDatabaseCapable(activeCapabilities);

  useEffect(() => {
    if (!isOpen || !canSwitch) return;
    setSearch("");
    setSelectedIndex(0);
    void loadDatabases();
  }, [isOpen, canSwitch, loadDatabases]);

  const filteredDatabases = useMemo(
    () => fuzzyFilter(allDatabases ?? [], search, (name) => name),
    [allDatabases, search],
  );

  // Scroll the highlighted row into view while navigating with the keyboard.
  useEffect(() => {
    const activeEl = listRef.current?.querySelector('[data-active="true"]');
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (database: string) => {
      onClose();
      if (!selectedDatabases.includes(database)) {
        setSelectedDatabases([...selectedDatabases, database]);
      }
      // Makes it the active database: the sidebar auto-expands its node.
      setActiveTable(null, database);
    },
    [onClose, selectedDatabases, setSelectedDatabases, setActiveTable],
  );

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredDatabases.length > 0
            ? (prev + 1) % filteredDatabases.length
            : 0,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredDatabases.length > 0
            ? (prev - 1 + filteredDatabases.length) % filteredDatabases.length
            : 0,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const database = filteredDatabases[selectedIndex];
        if (database) handleSelect(database);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, filteredDatabases, selectedIndex, handleSelect, onClose]);

  if (!isOpen || !canSwitch) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-[100] backdrop-blur-sm pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] max-h-[60vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-default bg-base">
          <Search size={18} className="text-secondary shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            className="flex-1 bg-transparent text-primary placeholder-muted outline-none text-sm"
            placeholder={t("databaseSwitcher.placeholder", {
              defaultValue: "Search databases...",
            })}
            autoFocus
          />
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* List */}
        <div ref={listRef} className="overflow-y-auto flex-1 flex flex-col py-1">
          {isLoading ? (
            <div className="px-4 py-8 flex items-center justify-center gap-2 text-muted text-sm">
              <Loader2 size={14} className="animate-spin" />
              {t("databaseSwitcher.loading", {
                defaultValue: "Loading databases...",
              })}
            </div>
          ) : loadError ? (
            <div className="px-4 py-6 flex flex-col items-center gap-3 text-center">
              <p className="text-xs text-red-400 flex items-start gap-1.5 max-w-full">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                <span className="break-words min-w-0">{loadError}</span>
              </p>
              <button
                type="button"
                onClick={() => void loadDatabases()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-strong bg-base text-xs font-medium text-secondary hover:text-primary hover:bg-surface-secondary transition-colors"
              >
                <RefreshCw size={12} />
                {t("sidebar.retry")}
              </button>
            </div>
          ) : filteredDatabases.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted text-sm">
              {search
                ? t("databaseSwitcher.noResults", {
                    query: search,
                    defaultValue: 'No databases match "{{query}}"',
                  })
                : t("databaseSwitcher.empty", {
                    defaultValue: "No databases found",
                  })}
            </div>
          ) : (
            filteredDatabases.map((database, idx) => {
              const isActive = idx === selectedIndex;
              const isCurrent = database === activeSchema;
              const isSelected = selectedDatabases.includes(database);
              return (
                <div
                  key={database}
                  onClick={() => handleSelect(database)}
                  data-active={isActive}
                  className={`flex items-center justify-between gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    isActive
                      ? "bg-surface-secondary text-primary"
                      : "text-secondary hover:bg-surface-secondary hover:text-primary"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Database size={14} className="text-blue-400 shrink-0" />
                    <span className="text-sm font-medium truncate">
                      {database}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isCurrent ? (
                      <span className="text-[10px] uppercase font-bold text-blue-400 border border-blue-500/40 px-1.5 py-0.5 rounded tracking-wider select-none">
                        {t("databaseSwitcher.current", {
                          defaultValue: "Current",
                        })}
                      </span>
                    ) : (
                      isSelected && (
                        <Check size={13} className="text-green-400" />
                      )
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-default bg-base/50 flex justify-between text-[11px] text-muted select-none">
          <span>
            {t("databaseSwitcher.count", {
              count: filteredDatabases.length,
              defaultValue: "{{count}} databases",
            })}
          </span>
          <div className="flex gap-4">
            <span>{t("editor.quickNavigator.navigationHint")}</span>
            <span>{t("editor.quickNavigator.escHint")}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
