import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  ArrowUpCircle,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Download,
  RotateCcw,
  Check,
  ExternalLink,
  Settings as SettingsIcon,
  Trash2,
  ChevronDown,
  CheckCircle2,
  Plug,
  PackageCheck,
  Power,
  Boxes,
  Search,
  FolderOpen,
  CircleStop,
  Palette,
} from "lucide-react";
import clsx from "clsx";
import { useSettings } from "../../hooks/useSettings";
import { useDrivers } from "../../hooks/useDrivers";
import { useTheme } from "../../hooks/useTheme";
import { usePluginRegistry } from "../../hooks/usePluginRegistry";
import { useTabularisClient } from "../../hooks/useTabularisClient";
import { toErrorMessage } from "../../utils/errors";
import { usePlatformCapabilities } from "../../hooks/usePlatformCapabilities";
import { useSearchParams } from "react-router-dom";
import { useDatabase } from "../../hooks/useDatabase";
import { PluginCard, PLUGIN_ICON_BUTTON_CLASS } from "../plugins/PluginCard";
import { getPluginVersionState } from "../../utils/pluginVersions";
import { mergeLocalThemePlugins } from "../../utils/localThemePlugins";
import { getPluginUpdates } from "../../utils/pluginUpdates";
import {
  matchesPluginKind,
  parsePluginKindFilter,
  pluginKind,
  type PluginKindFilter,
} from "../../utils/plugins";
import { removePluginConfig } from "../../utils/pluginConfig";
import { findConnectionsForDrivers } from "../../utils/connectionManager";
import { APP_VERSION } from "../../version";
import type { PluginManifest, RegistryPluginWithStatus } from "../../types/plugins";
import { PluginInstallErrorModal } from "../modals/PluginInstallErrorModal";
import { PluginReadmeModal } from "../modals/PluginReadmeModal";
import { PluginRemoveModal } from "../modals/PluginRemoveModal";
import { PluginStartErrorModal } from "../modals/PluginStartErrorModal";
import { SlotAnchor } from "../ui/SlotAnchor";
import { PLUGIN_INSTALL_DEADLINE_MS } from "../../api/pluginLifecycle";
import { Chip } from "../ui/Chip";
import { TONE_SOFT_BG_CLASS, TONE_TEXT_CLASS, type Tone } from "../../utils/tones";
import { CountBadge } from "../ui/CountBadge";

/* ── Types ── */

type AvailableFilter = "all" | "installed" | "updates";

const INSTALL_CANCELLED_ERROR = "PLUGIN_INSTALL_CANCELLED";

const FOOTER_ICON_DANGER =
  "p-1.5 rounded-lg text-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:text-accent-error hover:bg-accent-error/10";

/* ── Version dropdown ── */

interface VersionOption {
  version: string;
  isInstalled: boolean;
  isLatest: boolean;
}

function VersionDropdown({
  options,
  value,
  onChange,
  isDowngrade,
  label,
  disabled = false,
  attached = false,
  attachedClassName,
}: {
  options: VersionOption[];
  value: string;
  onChange: (v: string) => void;
  isDowngrade: boolean;
  label: string;
  disabled?: boolean;
  /** Render as the right segment of a split button instead of a standalone picker. */
  attached?: boolean;
  /** Colour classes of the primary segment, so both halves read as one control. */
  attachedClassName?: string;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; minWidth: number; maxHeight: number }>({
    left: 0, minWidth: 0, maxHeight: 288,
  });
  const [activeIndex, setActiveIndex] = useState(-1);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Anchor below the trigger, or above it when the list would run past the
  // viewport; the height is capped to the free space so the list scrolls
  // instead of being clipped.
  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const margin = 8;
    const below = window.innerHeight - r.bottom - margin;
    const above = r.top - margin;
    const openUp = below < 200 && above > below;
    const room = Math.max(120, Math.min(320, (openUp ? above : below) - 4));
    setPos({
      ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      left: Math.max(margin, Math.min(r.left, window.innerWidth - 232)),
      minWidth: Math.max(r.width, 224),
      maxHeight: room,
    });
  }, []);

  const openList = () => {
    updatePos();
    setActiveIndex(Math.max(0, options.findIndex((opt) => opt.version === value)));
    setIsOpen(true);
  };
  const choose = (version: string) => {
    onChange(version);
    setIsOpen(false);
    btnRef.current?.focus();
  };
  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + step + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) choose(options[activeIndex].version);
    } else if (e.key === "Tab") {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    dropRef.current
      ?.querySelectorAll<HTMLElement>("[role='option']")[activeIndex]
      ?.scrollIntoView({ block: "nearest" });
  }, [isOpen, activeIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !dropRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [isOpen, updatePos]);

  return (
    <>
      {attached ? (
        <button
          ref={btnRef}
          type="button"
          disabled={disabled}
          aria-label={label}
          title={label}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => (isOpen ? setIsOpen(false) : openList())}
          onKeyDown={onTriggerKeyDown}
          className={clsx(
            "flex h-7 items-center justify-center rounded-r-md border border-l-0 px-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            attachedClassName,
          )}
        >
          <ChevronDown
            size={11}
            className={clsx("transition-transform duration-150", isOpen && "rotate-180")}
          />
        </button>
      ) : (
        <button
          ref={btnRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => (isOpen ? setIsOpen(false) : openList())}
          onKeyDown={onTriggerKeyDown}
          className={clsx(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] transition-colors cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed",
            isDowngrade
              ? "text-accent-warning hover:bg-accent-warning/10"
              : isOpen
                ? "bg-surface-secondary text-primary"
                : "text-muted hover:bg-surface-secondary/60 hover:text-primary",
          )}
        >
          <RotateCcw size={11} />
          <span>{label}</span>
          <ChevronDown
            size={11}
            className={clsx("transition-transform duration-150", isOpen && "rotate-180")}
          />
        </button>
      )}

      {isOpen &&
        createPortal(
          <div
            ref={dropRef}
            style={{
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              minWidth: pos.minWidth,
              maxHeight: pos.maxHeight,
            }}
            role="listbox"
            aria-label={label}
            className="custom-scrollbar fixed z-[200] flex flex-col overflow-y-auto overscroll-contain rounded-lg border border-strong bg-elevated py-1 shadow-xl"
          >
            {options.map((opt, index) => {
              const isSelected = opt.version === value;
              const isPrerelease = opt.version.includes("-");
              return (
                <button
                  key={opt.version}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(opt.version)}
                  className={clsx(
                    "mx-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    index === activeIndex ? "bg-surface-secondary" : "hover:bg-surface-secondary/60",
                  )}
                >
                  <span className="flex w-3.5 shrink-0 items-center justify-center">
                    {isSelected && <Check size={12} className="text-accent" />}
                  </span>
                  <span
                    className={clsx(
                      "font-mono tabular-nums",
                      isSelected ? "text-primary font-semibold" : isPrerelease ? "text-secondary" : "text-primary",
                    )}
                  >
                    v{opt.version}
                  </span>
                  <span className="ml-auto flex items-center gap-1 pl-3">
                    {opt.isInstalled && (
                      <Chip tone="success" size="sm">{t("settings.plugins.installed")}</Chip>
                    )}
                    {opt.isLatest && (
                      <Chip tone="update" size="sm">{t("settings.plugins.latest")}</Chip>
                    )}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ── Shared install / version controls ── */

function PluginVersionActions({
  plugin,
  selectedVersion,
  installingPluginId,
  cancellingPluginId,
  onSelectVersion,
  onInstall,
  onCancelInstall,
}: {
  plugin: RegistryPluginWithStatus;
  selectedVersion?: string;
  installingPluginId: string | null;
  cancellingPluginId: string | null;
  onSelectVersion: (version: string) => void;
  onInstall: (pluginId: string, version: string) => void;
  onCancelInstall: (pluginId: string) => void;
}) {
  const { t } = useTranslation();
  const version = getPluginVersionState(plugin, selectedVersion, APP_VERSION);
  const isInstalling = installingPluginId === plugin.id;
  const isCancelling = cancellingPluginId === plugin.id;
  const hasPicker = version.options.length > 1;
  const pickerLabel = version.isDefaultSelection
    ? t("settings.plugins.olderVersions")
    : `v${version.selectedVersion}`;
  const actionLabel = `${t(
    version.isDowngrade
      ? "settings.plugins.downgrade"
      : version.isUpdate
        ? "settings.plugins.update"
        : "settings.plugins.install",
  )} v${version.selectedVersion}`;

  // Nothing to do: the chip row already says "up to date"; an explicit pick of
  // the installed release gets a short note, plus the picker to move on.
  if (version.isSelectedInstalled) {
    return (
      <>
        {!version.isDefaultSelection && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <CheckCircle2 size={12} className="text-accent-success" />
            {`${t("settings.plugins.installed")} v${version.selectedVersion}`}
          </span>
        )}
        {hasPicker && (
          <VersionDropdown
            options={version.options}
            value={version.selectedVersion}
            onChange={onSelectVersion}
            isDowngrade={false}
            label={pickerLabel}
          />
        )}
      </>
    );
  }

  if (!version.platformSupported) {
    return (
      <>
        <span className="text-xs text-muted italic">
          {t("settings.plugins.platformNotSupported")}
        </span>
        {hasPicker && (
          <VersionDropdown
            options={version.options}
            value={version.selectedVersion}
            onChange={onSelectVersion}
            isDowngrade={version.isDowngrade}
            label={pickerLabel}
          />
        )}
      </>
    );
  }

  // Soft (tinted) buttons keep a grid of cards light. Colour encodes risk, not
  // verb: install/update are routine (primary), downgrade needs care (warning),
  // cancel aborts (danger).
  const toneClass = !version.isCompatible
    ? "cursor-not-allowed border-default bg-surface-tertiary/60 text-muted"
    : isInstalling
      ? "border-accent-error/30 bg-accent-error/12 text-accent-error hover:bg-accent-error/20"
      : version.isDowngrade
        ? "border-accent-warning/30 bg-accent-warning/12 text-accent-warning hover:bg-accent-warning/20"
        : "border-accent-primary/30 bg-accent-primary/12 text-accent hover:bg-accent-primary/20";
  const disabled =
    !version.isCompatible ||
    (installingPluginId !== null && !isInstalling) ||
    isCancelling;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="inline-flex rounded-md">
        <button
          onClick={() => isInstalling
            ? onCancelInstall(plugin.id)
            : onInstall(plugin.id, version.selectedVersion)}
          disabled={disabled}
          title={!version.isCompatible
            ? t("settings.plugins.requiresVersion", { version: version.minVersion })
            : undefined}
          className={clsx(
            "flex h-7 min-w-0 items-center justify-center gap-1.5 border px-2.5 text-[11px] font-semibold transition-colors disabled:opacity-50",
            hasPicker && !isInstalling ? "rounded-l-md" : "rounded-md",
            toneClass,
          )}
        >
          {isCancelling ? <Loader2 size={11} className="animate-spin" />
            : isInstalling ? <CircleStop size={11} />
              : version.isDowngrade ? <RotateCcw size={11} />
                : version.isUpdate ? <RefreshCw size={11} />
                  : <Download size={11} />}
          {isInstalling ? t("common.cancel") : actionLabel}
        </button>
        {hasPicker && !isInstalling && (
          // Split button: the arrow opens the release list, so the version
          // choice lives on the action itself instead of a second control.
          <VersionDropdown
            attached
            attachedClassName={toneClass}
            options={version.options}
            value={version.selectedVersion}
            onChange={onSelectVersion}
            isDowngrade={version.isDowngrade}
            // Stays usable when the target is incompatible, so another release can be picked.
            disabled={installingPluginId !== null || isCancelling}
            label={pickerLabel}
          />
        )}
      </div>
      {!version.isCompatible && (
        <span className="text-[10px] font-medium text-accent-warning/90">
          {t("settings.plugins.requiresVersion", { version: version.minVersion })}
        </span>
      )}
    </div>
  );
}

/* ── Plugin toggle ── */

function PluginToggle({
  enabled,
  disabled,
  onToggle,
  label,
  title,
}: {
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={label ?? (enabled ? "Disable plugin" : "Enable plugin")}
      aria-pressed={enabled}
      title={title}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent",
        "transition-colors duration-200 ease-in-out",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        enabled ? "bg-accent-primary" : "bg-surface-tertiary",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <span
        className={clsx(
          "pointer-events-none inline-block h-4 w-4 rounded-full shadow",
          "transition duration-200 ease-in-out",
          enabled ? "translate-x-4 bg-inverse" : "translate-x-0 bg-primary",
        )}
      />
    </button>
  );
}

/* ── Stats panel ── */

function StatCard({
  icon,
  value,
  label,
  tone = "neutral",
  onClick,
  active = false,
}: {
  icon: ReactNode;
  value: number;
  label: string;
  tone?: Tone;
  /** When given, the tile doubles as a filter shortcut for the list below. */
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      className={clsx(
        "relative flex items-center gap-3 p-4 text-left transition-colors",
        onClick && "cursor-pointer hover:bg-surface-secondary/30 focus:outline-none focus-visible:bg-surface-secondary/30",
        active && "bg-surface-secondary/40",
      )}
    >
      {active && (
        // Same underline as the active filter tab: the tile and the tab are one filter.
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-accent-primary" />
      )}
      <div className={clsx("p-2.5 rounded-lg shrink-0", TONE_SOFT_BG_CLASS[tone], TONE_TEXT_CLASS[tone])}>
        {icon}
      </div>
      <div className="min-w-0">
        <div
          className={clsx(
            "text-2xl font-bold leading-none tabular-nums",
            tone === "neutral" ? "text-primary" : TONE_TEXT_CLASS[tone],
          )}
        >
          {value}
        </div>
        <div className="text-[10px] text-muted mt-1 leading-tight truncate">
          {label}
        </div>
      </div>
    </Tag>
  );
}

/* ── Main tab ── */

interface PluginsTabProps {
  onOpenPluginSettings?: (pluginId: string) => void;
  onPluginsChanged?: (change: PluginSidebarChange) => void;
}

interface PluginSidebarChange {
  type: "install" | "remove";
  pluginId: string;
  pluginName?: string;
}

export function PluginsTab({
  onOpenPluginSettings,
  onPluginsChanged,
}: PluginsTabProps) {
  const { t } = useTranslation();
  const client = useTabularisClient();
  const platform = usePlatformCapabilities();
  const { settings, updateSetting } = useSettings();
  const {
    allDrivers,
    installedPlugins,
    refresh: refreshDrivers,
  } = useDrivers();
  const { catalog, refreshCatalog } = useTheme();
  const {
    plugins: remotePlugins,
    loading: registryLoading,
    error: registryError,
    refresh: refreshRegistry,
  } = usePluginRegistry();
  const registryPlugins = useMemo(
    () => mergeLocalThemePlugins(remotePlugins, catalog.themes.map(({ entry }) => entry)),
    [remotePlugins, catalog.themes],
  );
  const pluginUpdates = useMemo(() => getPluginUpdates(registryPlugins, APP_VERSION), [registryPlugins]);
  const { openConnectionIds, connectionDataMap, disconnect, connections } = useDatabase();

  const [installingPluginId, setInstallingPluginId] = useState<string | null>(
    null,
  );
  const [cancellingPluginId, setCancellingPluginId] = useState<string | null>(
    null,
  );
  const [pluginInstallError, setPluginInstallError] = useState<{
    pluginId: string;
    error: string;
    operation: "install" | "uninstall";
  } | null>(null);
  const [pluginStartError, setPluginStartError] = useState<{
    pluginId: string;
    pluginName: string;
    error: string;
  } | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<
    Record<string, string>
  >({});
  const [uninstallingPluginId, setUninstallingPluginId] = useState<
    string | null
  >(null);
  const [pluginRemoveConfirm, setPluginRemoveConfirm] = useState<{
    pluginId: string;
    pluginName: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [togglingThemeId, setTogglingThemeId] = useState<string | null>(null);
  const [themeToggleError, setThemeToggleError] = useState<string | null>(null);
  const [themeRemoveConfirm, setThemeRemoveConfirm] = useState<{
    packageName: string;
    registryKey: string;
    displayName: string;
    busy?: boolean;
    committed?: boolean;
    error?: string;
    warnings?: string[];
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get("filter");
  const activeFilter: AvailableFilter =
    filterParam === "updates" || filterParam === "installed" ? filterParam : "all";
  const setActiveFilter = (filter: AvailableFilter) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("filter", filter);
        return next;
      },
      { replace: true },
    );
  };
  // Kind (drivers / themes) is orthogonal to the status filter above and lives
  // in the URL too, so Appearance can deep-link straight to the theme list.
  const activeKind = parsePluginKindFilter(searchParams.get("kind"));
  const setActiveKind = (kind: PluginKindFilter) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (kind === "all") next.delete("kind");
        else next.set("kind", kind);
        return next;
      },
      { replace: true },
    );
  };
  const openAppearance = () => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("tab", "appearance");
        next.delete("filter");
        next.delete("kind");
        return next;
      },
      { replace: true },
    );
  };
  // Theme installs run through the theme package installer, which is keyed by
  // registry + package; the key is resolved at install time and kept for cancel.
  const themeRegistryKeys = useRef(new Map<string, string>());
  const [readmePlugin, setReadmePlugin] = useState<{
    slug: string;
    name: string;
    registryUrl: string | null;
  } | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const updateSettingRef = useRef(updateSetting);
  updateSettingRef.current = updateSetting;
  const installedPluginsRef = useRef(installedPlugins);
  installedPluginsRef.current = installedPlugins;

  const activeExternalDrivers = useMemo(
    () =>
      settings.activeExternalDrivers ??
      installedPlugins.map((plugin) => plugin.id),
    [settings.activeExternalDrivers, installedPlugins],
  );
  const externalDrivers = useMemo(
    () => allDrivers.filter((driver) => driver.is_builtin !== true),
    [allDrivers],
  );
  const kindPlugins = useMemo(
    () => registryPlugins.filter((p) => matchesPluginKind(p, activeKind)),
    [registryPlugins, activeKind],
  );
  const kindUpdates = useMemo(
    () => pluginUpdates.filter((p) => matchesPluginKind(p, activeKind)),
    [pluginUpdates, activeKind],
  );
  const kindCounts = useMemo(
    () => ({
      all: registryPlugins.length,
      driver: registryPlugins.filter((p) => pluginKind(p) === "driver").length,
      theme: registryPlugins.filter((p) => pluginKind(p) === "theme").length,
    }),
    [registryPlugins],
  );
  // Local and registry themes share the list, but never driver manifests.
  const installedThemes = useMemo(
    () =>
      activeKind === "driver"
        ? []
        : registryPlugins.filter(
            (p) => pluginKind(p) === "theme" && !!p.installed_version,
          ),
    [registryPlugins, activeKind],
  );
  const updateCount = kindUpdates.length;

  const filteredPlugins = useMemo(() => {
    let list = kindPlugins;
    if (activeFilter === "installed") {
      list = list.filter((p) => !!p.installed_version);
    } else if (activeFilter === "updates") {
      list = kindUpdates;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          (p.author?.toLowerCase().includes(q) ?? false),
      );
    }
    return list;
  }, [kindPlugins, kindUpdates, activeFilter, searchQuery]);

  // The shared registry refreshes itself; refresh this tab's driver list too.
  useEffect(() => {
    let cleanup: UnlistenFn | null = null;
    let mounted = true;
    listen("tabularis://plugin-installed", () => {
      if (!mounted) return;
      refreshDrivers();
    })
      .then((u) => {
        if (mounted) cleanup = u;
        else u();
      })
      .catch(() => {
        /* ignore — listener is best-effort */
      });
    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [refreshDrivers]);

  useEffect(() => {
    client.call("get_plugin_startup_errors", undefined)
      .then((errors) => {
        if (errors.length > 0) {
          const failedIds = errors.map((e) => e.plugin_id);
          const activeExt =
            settingsRef.current.activeExternalDrivers ??
            installedPluginsRef.current.map((plugin) => plugin.id);
          const cleaned = activeExt.filter((id) => !failedIds.includes(id));
          if (cleaned.length !== activeExt.length) {
            updateSettingRef.current("activeExternalDrivers", cleaned);
          }
          const first = errors[0];
          setPluginStartError({
            pluginId: first.plugin_id,
            pluginName: first.plugin_id,
            error: first.error,
          });
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, [client]);

  const openPluginsFolder = useCallback(() => {
    invoke("open_plugins_dir").catch(() => {
      /* best-effort — the folder may still be reachable manually */
    });
  }, []);

  const handleOpenPluginSettings = useCallback(
    (pluginId: string) => {
      onOpenPluginSettings?.(pluginId);
    },
    [onOpenPluginSettings],
  );

  const doInstall = useCallback(
    async (pluginId: string, version: string) => {
      setInstallingPluginId(pluginId);
      // The picked version is spent once installed. Keeping it would pin the
      // card to what's now on disk, which reads as neither "up to date" (it
      // isn't latest) nor updatable (it is installed) — and the picker hides
      // itself once only one other release is left, leaving no way out.
      const forgetSelection = () =>
        setSelectedVersions((prev) => {
          if (!(pluginId in prev)) return prev;
          const next = { ...prev };
          delete next[pluginId];
          return next;
        });
      const registryPlugin = registryPlugins.find((plugin) => plugin.id === pluginId);
      try {
        if (registryPlugin && pluginKind(registryPlugin) === "theme") {
          // Declarative package: same button, different installer. Nothing is
          // activated as a driver and the theme catalog is what changes.
          const snapshot = await client.call("fetch_theme_registry", {
            packageName: pluginId,
          });
          themeRegistryKeys.current.set(pluginId, snapshot.registryKey);
          await client.call("install_registry_theme", {
            packageName: pluginId,
            expectedRegistryKey: snapshot.registryKey,
            version,
          });
          forgetSelection();
          await refreshCatalog();
          refreshRegistry();
          return;
        }
        await client.call(
          "install_plugin",
          { pluginId, version },
          { deadlineMs: PLUGIN_INSTALL_DEADLINE_MS },
        );
        forgetSelection();
        await updateSettingRef.current(
          "activeExternalDrivers",
          Array.from(
            new Set([
              ...(settingsRef.current.activeExternalDrivers ??
                installedPluginsRef.current.map((plugin) => plugin.id)),
              pluginId,
            ]),
          ),
        );
        refreshRegistry();
        refreshDrivers();
        const pluginName =
          registryPlugins.find((plugin) => plugin.id === pluginId)?.name ??
          pluginId;
        onPluginsChanged?.({ type: "install", pluginId, pluginName });
      } catch (err) {
        if (toErrorMessage(err) !== INSTALL_CANCELLED_ERROR) {
          setPluginInstallError({
            pluginId,
            error: toErrorMessage(err),
            operation: "install",
          });
        }
      } finally {
        themeRegistryKeys.current.delete(pluginId);
        setInstallingPluginId(null);
        setCancellingPluginId(null);
      }
    },
    [client, refreshRegistry, refreshDrivers, refreshCatalog, onPluginsChanged, registryPlugins],
  );

  const doCancelInstall = useCallback(async (pluginId: string) => {
    setCancellingPluginId(pluginId);
    try {
      const registryKey = themeRegistryKeys.current.get(pluginId);
      if (registryKey) {
        await client.call("cancel_theme_install", { registryKey, packageName: pluginId });
      } else {
        await client.call("cancel_plugin_install", { pluginId });
      }
    } catch (err) {
      setCancellingPluginId(null);
      setPluginInstallError({
        pluginId,
        error: toErrorMessage(err),
        operation: "install",
      });
    }
  }, [client]);

  const doRemove = useCallback(
    (pluginId: string, pluginName: string) => {
      setPluginRemoveConfirm({
        pluginId,
        pluginName,
        onConfirm: async () => {
          setUninstallingPluginId(pluginId);
          setPluginRemoveConfirm(null);
          try {
            const toDisconnect = findConnectionsForDrivers(
              openConnectionIds,
              connectionDataMap,
              [pluginId],
            );
            await Promise.all(toDisconnect.map((id) => disconnect(id)));
            await client.call("uninstall_plugin", { pluginId });
            const currentSettings = settingsRef.current;
            await updateSettingRef.current(
              "plugins",
              removePluginConfig(currentSettings.plugins, pluginId),
            );
            await updateSettingRef.current(
              "activeExternalDrivers",
              (
                currentSettings.activeExternalDrivers ??
                installedPlugins.map((plugin) => plugin.id)
              ).filter((id) => id !== pluginId),
            );
            refreshDrivers();
            refreshRegistry();
            onPluginsChanged?.({ type: "remove", pluginId });
          } catch (err) {
            setPluginInstallError({
              pluginId,
              error: String(err),
              operation: "uninstall",
            });
          } finally {
            setUninstallingPluginId(null);
          }
        },
      });
    },
    [
      openConnectionIds,
      connectionDataMap,
      disconnect,
      installedPlugins,
      refreshDrivers,
      refreshRegistry,
      onPluginsChanged,
      client,
    ],
  );

  const doToggle = useCallback(
    async (pluginId: string, pluginName: string, isEnabled: boolean) => {
      try {
        if (isEnabled) {
          await client.call("disable_plugin", { pluginId });
          await updateSetting(
            "activeExternalDrivers",
            activeExternalDrivers.filter((id) => id !== pluginId),
          );
        } else {
          await client.call("enable_plugin", { pluginId });
          await updateSetting(
            "activeExternalDrivers",
            Array.from(new Set([...activeExternalDrivers, pluginId])),
          );
        }
        refreshDrivers();
      } catch (err) {
        setPluginStartError({
          pluginId,
          pluginName,
          error: String(err),
        });
      }
    },
    [activeExternalDrivers, updateSetting, refreshDrivers, client],
  );

  const doToggleTheme = useCallback(
    async (packageName: string, registryKey: string, enabled: boolean) => {
      setTogglingThemeId(packageName);
      setThemeToggleError(null);
      try {
        // A package toggle applies to every variant. Saved theme selections and
        // driver preferences are retained; the refreshed catalog decides fallback.
        await client.call("set_theme_package_enabled", { packageName, registryKey, enabled });
        try {
          await refreshCatalog();
        } catch (error) {
          setThemeToggleError(`${t("themePackages.committedRefreshFailed")} ${toErrorMessage(error)}`);
        }
      } catch (error) {
        setThemeToggleError(`${packageName}: ${toErrorMessage(error)}`);
      } finally {
        setTogglingThemeId(null);
      }
    },
    [client, refreshCatalog, t],
  );

  const doRemoveTheme = async () => {
    if (!themeRemoveConfirm || themeRemoveConfirm.busy || themeRemoveConfirm.committed) return;
    const { registryKey, packageName } = themeRemoveConfirm;
    setThemeRemoveConfirm({ ...themeRemoveConfirm, busy: true, error: undefined });
    try {
      const result = await client.call("uninstall_theme_package", {
        registryKey, packageName,
      });
      setThemeRemoveConfirm((current) => current && { ...current, committed: true, warnings: result.warnings });
      try {
        await Promise.all([refreshCatalog(), refreshRegistry()]);
      } catch (failure) {
        setThemeRemoveConfirm((current) => current && {
          ...current, error: `${t("themePackages.committedRefreshFailed")} ${toErrorMessage(failure)}`,
        });
        return;
      }
      if (result.warnings.length === 0) setThemeRemoveConfirm(null);
    } catch (failure) {
      setThemeRemoveConfirm((current) => current && { ...current, error: toErrorMessage(failure) });
    } finally {
      setThemeRemoveConfirm((current) => current && { ...current, busy: false });
    }
  };

  const renderVersionActions = (plugin: RegistryPluginWithStatus) => (
    <PluginVersionActions
      plugin={plugin}
      selectedVersion={selectedVersions[plugin.id]}
      installingPluginId={installingPluginId}
      cancellingPluginId={cancellingPluginId}
      onSelectVersion={(version) => setSelectedVersions((previous) => ({
        ...previous,
        [plugin.id]: version,
      }))}
      onInstall={doInstall}
      onCancelInstall={doCancelInstall}
    />
  );

  // One card for every registry entry, whatever its kind: only the install
  // path differs (driver installer vs. theme package dialog).
  const renderRegistryCard = (plugin: RegistryPluginWithStatus) => {
    const isTheme = pluginKind(plugin) === "theme";
    const themeEntry = isTheme ? catalog.themes.find(({ entry }) =>
      entry.origin.kind === "installed" && entry.origin.identity.packageName === plugin.id,
    )?.entry : undefined;
    const themeIdentity = themeEntry?.origin.kind === "installed" ? themeEntry.origin.identity : undefined;
    const isLocalOnly = !remotePlugins.some((remote) => remote.id === plugin.id && pluginKind(remote) === pluginKind(plugin));
      const installedBadge = plugin.installed_version ? (
        <Chip>
          {t("settings.plugins.installed")} v
          {plugin.installed_version}
        </Chip>
      ) : undefined;

      // Tags from the Tabularium catalogue, as ghost tokens so they never
      // compete with the status chips. The kind itself is a first-class chip
      // on the card (driver vs theme), so it is not repeated here.
      const remainingTags = (plugin.tags ?? []).filter(
        (t) => t && t !== plugin.kind && t !== "driver" && t !== "theme",
      );
      const tagMeta =
        remainingTags.length > 0 ? (
          <>
            {remainingTags.slice(0, 4).map((tag) => (
              <Chip key={tag} variant="ghost">{tag}</Chip>
            ))}
          </>
        ) : undefined;

      // If we know which registry served this plugin, link the
      // card title to its detail page on that registry (highest
      // priority); the upstream homepage becomes a small icon.
      const registryPageUrl = plugin.registry_base_url
        ? `${plugin.registry_base_url.replace(/\/+$/, "")}/plugins/${plugin.id}`
        : null;

      return (
        <PluginCard
          key={`${pluginKind(plugin)}:${plugin.id}`}
          kind={isTheme ? "theme" : "driver"}
          name={plugin.name}
          description={plugin.description}
          author={plugin.author}
          homepage={plugin.homepage}
          registryPageUrl={registryPageUrl}
          iconUrl={plugin.icon}
          downloads={plugin.downloads}
          manifest={isTheme ? undefined : allDrivers.find((driver) => driver.id === plugin.id)}
          version={plugin.installed_version ? undefined : plugin.latest_version}
          updateVersion={pluginUpdates.find((update) => update.id === plugin.id && pluginKind(update) === pluginKind(plugin))?.latest_version}
          upToDate={!isLocalOnly && !!plugin.installed_version && plugin.installed_version === plugin.latest_version}
          status={<>
            {installedBadge}
            {themeEntry && !themeEntry.available && <Chip>{t("themePackages.disabled")}</Chip>}
          </>}
          control={themeEntry && themeIdentity ? (
            <PluginToggle
              enabled={themeEntry.available}
              disabled={togglingThemeId !== null || installingPluginId === plugin.id}
              label={t(themeEntry.available ? "themePackages.disable" : "themePackages.enable")}
              title={t("themePackages.packageWarning")}
              onToggle={() => void doToggleTheme(
                themeIdentity.packageName, themeIdentity.registryKey, !themeEntry.available,
              )}
            />
          ) : undefined}
          meta={tagMeta}
          onShowReadme={isLocalOnly ? undefined : () =>
            setReadmePlugin({
              slug: plugin.id,
              name: plugin.name,
              registryUrl: plugin.registry_base_url ?? null,
            })
          }
          actions={isLocalOnly ? undefined : renderVersionActions(plugin)}
          secondaryActions={
            isTheme && plugin.installed_version ? (
              <>
                <button
                  type="button"
                  onClick={openAppearance}
                  className={PLUGIN_ICON_BUTTON_CLASS}
                  aria-label={t("settings.plugins.manageThemes")}
                  title={t("settings.plugins.manageThemes")}
                >
                  <Palette size={14} />
                </button>
                {themeIdentity && (
                  <button
                    type="button"
                    onClick={() => setThemeRemoveConfirm({
                      packageName: themeIdentity.packageName,
                      registryKey: themeIdentity.registryKey,
                      displayName: plugin.name,
                    })}
                    disabled={togglingThemeId !== null || installingPluginId !== null}
                    aria-label={t("themePackages.removePackage")}
                    title={t("themePackages.removePackage")}
                    className={FOOTER_ICON_DANGER}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </>
            ) : undefined
          }
        />
      );
  };

  return (
    <>
      <div className="space-y-8">
        {/* Overview panel: identity + toolbar on top, metric tiles below.
            The tiles double as filter shortcuts for the list further down. */}
        <div className="rounded-2xl border border-strong bg-elevated overflow-hidden">
          <div className="p-5 border-b border-default bg-surface-secondary/50">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-accent-primary/10 text-accent shrink-0">
                  <Plug size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-primary">
                    {t("settings.plugins.overviewTitle")}
                  </h2>
                  <p className="text-xs text-muted mt-0.5">
                    {t("settings.plugins.overviewDesc")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {platform.negotiation.environment === "tauri" && (
                  <button
                    type="button"
                    onClick={openPluginsFolder}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs text-muted hover:text-primary hover:bg-surface-secondary/60 transition-colors"
                  >
                    <FolderOpen size={13} />
                    {t("settings.plugins.openFolder")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    refreshRegistry();
                    refreshDrivers();
                    void refreshCatalog();
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-default bg-base text-xs text-secondary hover:text-primary hover:border-strong transition-colors"
                >
                  <RefreshCw size={13} className={clsx(registryLoading && "animate-spin")} />
                  {t("settings.plugins.refresh")}
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-default">
            <StatCard
              icon={<PackageCheck size={15} />}
              value={
                (activeKind === "theme" ? 0 : installedPlugins.length) +
                installedThemes.length
              }
              label={t("settings.plugins.installedMetric")}
              onClick={() => setActiveFilter("installed")}
              active={activeFilter === "installed"}
            />
            <StatCard
              icon={<Power size={15} />}
              value={externalDrivers.length}
              label={t("settings.plugins.enabledMetric")}
              tone="success"
            />
            <StatCard
              icon={<Boxes size={15} />}
              value={kindPlugins.length}
              label={t("settings.plugins.registryMetric")}
              onClick={() => setActiveFilter("all")}
              active={activeFilter === "all"}
            />
            <StatCard
              icon={<ArrowUpCircle size={15} />}
              value={updateCount}
              label={t("settings.plugins.updatesMetric")}
              tone={updateCount > 0 ? "update" : "neutral"}
              onClick={() => setActiveFilter("updates")}
              active={activeFilter === "updates"}
            />
          </div>
        </div>

        {themeToggleError && <p role="alert" className="text-sm text-accent-error">{themeToggleError}</p>}

        {/* Available */}
        <div className="mb-8">
          {/* Section header: title + search */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {t("settings.plugins.available")}
              </h3>
              <p className="text-xs text-muted mt-0.5">
                {t("settings.plugins.availableDesc")}
              </p>
            </div>
            <div className="relative shrink-0">
              <Search
                size={12}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
                type="text"
                placeholder={t("settings.plugins.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-44 rounded-lg border border-default bg-base py-1.5 pl-7 pr-3 text-xs text-primary placeholder:text-muted transition-all focus:w-56 focus:border-focus focus:outline-none"
              />
            </div>
          </div>

          {/* Filter tabs (status) + kind selector */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default">
            <div className="flex items-center gap-0.5">
              {(
                [
                  {
                    id: "all" as const,
                    label: t("settings.plugins.filterAll"),
                    count: kindPlugins.length,
                  },
                  {
                    id: "installed" as const,
                    label: t("settings.plugins.filterInstalled"),
                    count:
                      (activeKind === "theme"
                        ? 0
                        : allDrivers.length +
                          installedPlugins.filter(
                            (p) => !allDrivers.some((d) => d.id === p.id),
                          ).length) + installedThemes.length,
                  },
                  {
                    id: "updates" as const,
                    label: t("settings.plugins.filterUpdates"),
                    count: updateCount,
                  },
                ] satisfies Array<{
                  id: AvailableFilter;
                  label: string;
                  count: number;
                }>
              ).map(({ id, label, count }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveFilter(id)}
                  className={clsx(
                    "flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors -mb-px",
                    activeFilter === id
                      ? "border-accent-primary text-primary"
                      : "border-transparent text-muted hover:text-secondary",
                  )}
                >
                  {label}
                  <CountBadge count={count} tone={id === "updates" ? "update" : "neutral"} />
                </button>
              ))}
            </div>
            <div
              role="group"
              aria-label={t("settings.plugins.kindFilter")}
              className="mb-1.5 inline-flex items-center gap-0.5 rounded-lg border border-default bg-base p-0.5"
            >
              {(
                [
                  {
                    id: "all" as const,
                    label: t("settings.plugins.kindAll"),
                    icon: <Boxes size={11} />,
                  },
                  {
                    id: "driver" as const,
                    label: t("settings.plugins.kindDrivers"),
                    icon: <Plug size={11} />,
                  },
                  {
                    id: "theme" as const,
                    label: t("settings.plugins.kindThemes"),
                    icon: <Palette size={11} />,
                  },
                ] satisfies Array<{
                  id: PluginKindFilter;
                  label: string;
                  icon: ReactNode;
                }>
              ).map(({ id, label, icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={activeKind === id}
                  onClick={() => setActiveKind(id)}
                  className={clsx(
                    "inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors",
                    activeKind === id
                      ? "bg-accent-primary/12 text-accent"
                      : "text-muted hover:bg-surface-secondary/60 hover:text-secondary",
                  )}
                >
                  {icon}
                  {label}
                  {id !== "all" && <CountBadge count={kindCounts[id]} />}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4">
            {activeFilter === "installed" ? (
              /* ── Installed tab ── */
              (() => {
                const sq = searchQuery.toLowerCase().trim();
                const matchesSearch = (item: { name: string; description: string }) =>
                  !sq ||
                  item.name.toLowerCase().includes(sq) ||
                  item.description.toLowerCase().includes(sq);
                const kindDrivers = activeKind === "theme" ? [] : allDrivers;
                const activeDrivers = kindDrivers.filter(matchesSearch);
                const disabledPlugins =
                  activeKind === "theme"
                    ? []
                    : installedPlugins
                        .filter((p) => !allDrivers.some((d) => d.id === p.id))
                        .filter(matchesSearch);
                const visibleThemes = installedThemes.filter(matchesSearch);
                const isEmpty =
                  activeDrivers.length === 0 &&
                  disabledPlugins.length === 0 &&
                  visibleThemes.length === 0;
                return (
                  <div className="grid gap-4 xl:grid-cols-2 lg:grid-cols-2 sm:grid-cols-1">
                    {activeDrivers.map((driver: PluginManifest) => {
                      const isBuiltin = driver.is_builtin === true;
                      const hasSettings = (driver.settings?.length ?? 0) > 0;
                      const registryPlugin = registryPlugins.find(
                        (p) => p.id === driver.id,
                      );
                      const isEnabled =
                        isBuiltin || activeExternalDrivers.includes(driver.id);
                      const statusNode = isBuiltin ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Chip tone="primary">Built-in</Chip>
                          {driver.deprecated && (
                            <Chip
                              tone="warning"
                              title={driver.deprecated.removal_date
                                ? t("settings.plugins.deprecatedTooltipDate", {
                                    replacement: driver.deprecated.replacement_id ?? "",
                                    date: driver.deprecated.removal_date,
                                  })
                                : t("settings.plugins.deprecatedTooltip", {
                                    replacement: driver.deprecated.replacement_id ?? "",
                                  })}
                            >
                              {t("settings.plugins.deprecated", { defaultValue: "Deprecated" })}
                            </Chip>
                          )}
                          {driver.deprecated?.replacement_id && (() => {
                            // "N of M connections migrated" — derived from the
                            // connections on this builtin vs its replacement.
                            const repl = driver.deprecated.replacement_id;
                            const onBuiltin = connections.filter(
                              (c) => c.params.driver === driver.id,
                            ).length;
                            const onPlugin = connections.filter(
                              (c) => c.params.driver === repl,
                            ).length;
                            const total = onBuiltin + onPlugin;
                            if (total === 0) return null;
                            return (
                              <span className="text-[10px] font-medium text-muted">
                                {t("settings.plugins.migrationProgress", {
                                  migrated: onPlugin,
                                  total,
                                  defaultValue: "{{migrated}} of {{total}} migrated",
                                })}
                              </span>
                            );
                          })()}
                        </span>
                      ) : (
                        <PluginToggle
                          enabled={isEnabled}
                          onToggle={() =>
                            doToggle(driver.id, driver.name, isEnabled)
                          }
                        />
                      );
                      return (
                        <PluginCard
                          key={driver.id}
                          name={driver.name}
                          description={driver.description}
                          version={driver.version}
                          author={
                            !isBuiltin ? registryPlugin?.author : undefined
                          }
                          homepage={
                            !isBuiltin ? registryPlugin?.homepage : undefined
                          }
                          manifest={driver}
                          iconUrl={registryPlugin?.icon}
                          downloads={registryPlugin?.downloads}
                          updateVersion={isBuiltin ? undefined : pluginUpdates.find((plugin) => plugin.id === driver.id)?.latest_version}
                          status={isBuiltin ? statusNode : undefined}
                          control={isBuiltin ? undefined : statusNode}
                          onShowReadme={
                            !isBuiltin && registryPlugin
                              ? () =>
                                  setReadmePlugin({
                                    slug: registryPlugin.id,
                                    name: driver.name,
                                    registryUrl:
                                      registryPlugin.registry_base_url ?? null,
                                  })
                              : undefined
                          }
                          upToDate={!isBuiltin && !!registryPlugin && registryPlugin.latest_version === driver.version}
                          actions={
                            !isBuiltin && registryPlugin
                              ? renderVersionActions({ ...registryPlugin, installed_version: driver.version })
                              : undefined
                          }
                          secondaryActions={
                            <>
                              {!isBuiltin && (
                                <SlotAnchor
                                  name="settings.plugin.actions"
                                  context={{ targetPluginId: driver.id }}
                                  className="flex items-center gap-1"
                                />
                              )}
                              {hasSettings && (
                                <button
                                  onClick={() =>
                                    handleOpenPluginSettings(driver.id)
                                  }
                                  className={PLUGIN_ICON_BUTTON_CLASS}
                                  title={t(
                                    "settings.plugins.pluginSettings.title",
                                  )}
                                >
                                  <SettingsIcon size={14} />
                                </button>
                              )}

                              {!isBuiltin && (
                                <button
                                  onClick={() =>
                                    doRemove(driver.id, driver.name)
                                  }
                                  disabled={
                                    uninstallingPluginId === driver.id
                                  }
                                  aria-label={t("settings.plugins.remove")}
                                  title={t("settings.plugins.remove")}
                                  className={FOOTER_ICON_DANGER}
                                >
                                  {uninstallingPluginId === driver.id ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <Trash2 size={14} />
                                  )}
                                </button>
                              )}
                            </>
                          }
                        />
                      );
                    })}

                    {disabledPlugins.map((plugin) => {
                      const registryPlugin = registryPlugins.find(
                        (r) => r.id === plugin.id,
                      );
                      return (
                        <PluginCard
                          key={plugin.id}
                          name={plugin.name}
                          description={plugin.description}
                          version={plugin.version}
                          author={registryPlugin?.author}
                          homepage={registryPlugin?.homepage}
                          iconUrl={registryPlugin?.icon}
                          downloads={registryPlugin?.downloads}
                          updateVersion={pluginUpdates.find((update) => update.id === plugin.id)?.latest_version}
                          onShowReadme={
                            registryPlugin
                              ? () =>
                                  setReadmePlugin({
                                    slug: registryPlugin.id,
                                    name: plugin.name,
                                    registryUrl:
                                      registryPlugin.registry_base_url ?? null,
                                  })
                              : undefined
                          }
                          control={
                            <PluginToggle
                              enabled={false}
                              onToggle={async () => {
                                try {
                                  await client.call("enable_plugin", {
                                    pluginId: plugin.id,
                                  });
                                  await updateSetting(
                                    "activeExternalDrivers",
                                    Array.from(
                                      new Set([
                                        ...activeExternalDrivers,
                                        plugin.id,
                                      ]),
                                    ),
                                  );
                                  refreshDrivers();
                                } catch (err) {
                                  setPluginStartError({
                                    pluginId: plugin.id,
                                    pluginName: plugin.name,
                                    error: String(err),
                                  });
                                }
                              }}
                            />
                          }
                          upToDate={!!registryPlugin && registryPlugin.latest_version === plugin.version}
                          actions={
                            registryPlugin
                              ? renderVersionActions({ ...registryPlugin, installed_version: plugin.version })
                              : undefined
                          }
                          secondaryActions={
                            <>
                              <SlotAnchor
                                name="settings.plugin.actions"
                                context={{ targetPluginId: plugin.id }}
                                className="flex items-center gap-1"
                              />
                              <button
                                onClick={() =>
                                  handleOpenPluginSettings(plugin.id)
                                }
                                className={PLUGIN_ICON_BUTTON_CLASS}
                                title={t(
                                  "settings.plugins.pluginSettings.title",
                                )}
                              >
                                <SettingsIcon size={14} />
                              </button>
                              <button
                                onClick={() =>
                                  doRemove(plugin.id, plugin.name)
                                }
                                disabled={uninstallingPluginId === plugin.id}
                                aria-label={t("settings.plugins.remove")}
                                title={t("settings.plugins.remove")}
                                className={FOOTER_ICON_DANGER}
                              >
                                {uninstallingPluginId === plugin.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Trash2 size={14} />
                                )}
                              </button>
                            </>
                          }
                        />
                      );
                    })}

                    {visibleThemes.map(renderRegistryCard)}

                    {isEmpty && (
                      <p className="col-span-full text-sm text-muted py-4">
                        {sq
                          ? t("settings.plugins.searchNoResults")
                          : t("settings.plugins.noPlugins")}
                      </p>
                    )}
                  </div>
                );
              })()
            ) : (
              /* ── All / Updates tabs (registry data) ── */
              <>
                {registryLoading && (
                  <div className="flex items-center gap-2 text-muted text-sm py-4">
                    <Loader2 size={16} className="animate-spin" />
                    {t("settings.plugins.loadingRegistry")}
                  </div>
                )}

                {registryError && (
                  <div className="bg-accent-error/10 border border-accent-error/30 text-accent-error px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                    <AlertTriangle size={16} />
                    {t("settings.plugins.registryError")}: {registryError}
                  </div>
                )}

                {(filteredPlugins.length > 0 || (!registryLoading && !registryError)) && (
                  <div className="grid gap-4 xl:grid-cols-2 lg:grid-cols-2 sm:grid-cols-1">
                    {filteredPlugins.map(renderRegistryCard)}

                {filteredPlugins.length === 0 && kindPlugins.length > 0 && (
                  <p className="col-span-full text-sm text-muted py-4">
                    {t("settings.plugins.searchNoResults")}
                  </p>
                )}
                {kindPlugins.length === 0 && (
                  <p className="col-span-full text-sm text-muted py-4">
                    {t("settings.plugins.noPlugins")}
                  </p>
                )}
              </div>
            )}

          </>
          )}
          </div>
        </div>
      </div>

      {/* Sticky attribution — pinned to the bottom of the Settings scroll
          area regardless of how far the user has scrolled. The negative
          horizontal margin pulls it through the parent's p-8 padding so
          the top border looks edge-to-edge inside the max-w-5xl. */}
      <div className="sticky bottom-0 z-10 -mx-8 mt-6 px-8 py-2.5 bg-base/85 backdrop-blur-md border-t border-default flex items-center justify-end text-xs text-muted">
        <span>{t("settings.plugins.poweredBy")}</span>
        <button
          type="button"
          onClick={() => void platform.openExternalUrl("https://tabularium.wiki")}
          className="ml-1 inline-flex items-center gap-1 text-primary cursor-pointer hover:underline underline-offset-2"
        >
          Tabularium
          <ExternalLink size={11} />
        </button>
      </div>

      {/* Modals */}
      {themeRemoveConfirm && (
        <PluginRemoveModal
          isOpen
          pluginName={themeRemoveConfirm.displayName}
          onClose={() => setThemeRemoveConfirm(null)}
          onConfirm={() => void doRemoveTheme()}
          busy={themeRemoveConfirm.busy}
          committed={themeRemoveConfirm.committed}
        >
          <p className="text-sm text-secondary leading-relaxed">{t("themePackages.packageWarning")}</p>
          {!!themeRemoveConfirm.warnings?.length && <p role="status" className="text-sm text-accent-warning whitespace-pre-wrap break-words">{themeRemoveConfirm.warnings.join("\n")}</p>}
          {themeRemoveConfirm.error && <p role="alert" className="text-sm text-accent-error whitespace-pre-wrap break-words">{themeRemoveConfirm.error}</p>}
        </PluginRemoveModal>
      )}
      <PluginInstallErrorModal
        isOpen={pluginInstallError !== null}
        onClose={() => setPluginInstallError(null)}
        pluginId={pluginInstallError?.pluginId ?? ""}
        error={pluginInstallError?.error ?? ""}
        operation={pluginInstallError?.operation ?? "install"}
        onOpenPluginsFolder={
          platform.negotiation.environment === "tauri"
            ? openPluginsFolder
            : undefined
        }
        onReload={async () => {
          await Promise.all([refreshDrivers(), refreshRegistry()]);
        }}
      />
      <PluginRemoveModal
        isOpen={pluginRemoveConfirm !== null}
        onClose={() => setPluginRemoveConfirm(null)}
        pluginName={pluginRemoveConfirm?.pluginName ?? ""}
        onConfirm={() => pluginRemoveConfirm?.onConfirm()}
      />
      {readmePlugin && (
        <PluginReadmeModal
          isOpen
          onClose={() => setReadmePlugin(null)}
          slug={readmePlugin.slug}
          pluginName={readmePlugin.name}
          registryUrl={readmePlugin.registryUrl}
        />
      )}
      <PluginStartErrorModal
        isOpen={pluginStartError !== null}
        onClose={() => setPluginStartError(null)}
        pluginId={pluginStartError?.pluginId ?? ""}
        error={pluginStartError?.error ?? ""}
        onConfigureInterpreter={
          pluginStartError !== null
            ? () => handleOpenPluginSettings(pluginStartError.pluginId)
            : undefined
        }
      />
    </>
  );
}
