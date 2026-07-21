import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
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
  Home,
} from "lucide-react";
import clsx from "clsx";
import { useSettings } from "../../hooks/useSettings";
import { useDrivers } from "../../hooks/useDrivers";
import { usePluginRegistry } from "../../hooks/usePluginRegistry";
import { useDatabase } from "../../hooks/useDatabase";
import { canUpdateToLatest, parseAuthor, versionGte } from "../../utils/plugins";
import { removePluginConfig } from "../../utils/pluginConfig";
import { findConnectionsForDrivers } from "../../utils/connectionManager";
import { APP_VERSION } from "../../version";
import type { PluginManifest } from "../../types/plugins";
import { PluginInstallErrorModal } from "../modals/PluginInstallErrorModal";
import { PluginRemoveModal } from "../modals/PluginRemoveModal";
import { PluginStartErrorModal } from "../modals/PluginStartErrorModal";
import { SlotAnchor } from "../ui/SlotAnchor";

/* ── Types ── */

type CardAccent = "green" | "amber" | "blue" | null;
type AvailableFilter = "all" | "installed" | "updates";

/* ── Band palette (deterministic per plugin name) ── */

const BAND_PALETTES = [
  { bg: "bg-blue-900/30", text: "text-blue-400/40" },
  { bg: "bg-purple-900/30", text: "text-purple-400/40" },
  { bg: "bg-emerald-900/30", text: "text-emerald-400/40" },
  { bg: "bg-rose-900/30", text: "text-rose-400/40" },
  { bg: "bg-cyan-900/30", text: "text-cyan-400/40" },
  { bg: "bg-orange-900/30", text: "text-orange-400/40" },
  { bg: "bg-teal-900/30", text: "text-teal-400/40" },
  { bg: "bg-indigo-900/30", text: "text-indigo-400/40" },
] as const;

function nameBandIndex(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  }
  return h % BAND_PALETTES.length;
}

/* ── Plugin card ── */

interface PluginCardProps {
  name: string;
  description: string;
  version?: string;
  author?: string;
  /** Upstream homepage / repo (shown as secondary link icon when registryPageUrl is also set). */
  homepage?: string;
  /** Registry detail page. Priority target for the name button. */
  registryPageUrl?: string | null;
  /** Square logo URL surfaced by the Tabularium registry. Falls back to the letter band when missing/broken. */
  iconUrl?: string | null;
  /** Aggregate download count — surfaces as a small badge if > 0. */
  downloads?: number | null;
  status?: ReactNode;
  meta?: ReactNode;
  actions: ReactNode;
  dimmed?: boolean;
  accent?: CardAccent;
  pulse?: boolean;
  showBand?: boolean;
}

function PluginCard({
  name,
  description,
  version,
  author,
  homepage,
  registryPageUrl,
  iconUrl,
  downloads,
  status,
  meta,
  actions,
  dimmed,
  accent,
  pulse,
  showBand,
}: PluginCardProps) {
  const { t } = useTranslation();
  const parsedAuthor = author ? parseAuthor(author) : null;
  const band = BAND_PALETTES[nameBandIndex(name)];

  // Name button: registry detail page wins; falls back to upstream homepage.
  const primaryHref = registryPageUrl ?? homepage ?? null;
  // Show a second small homepage icon when BOTH targets exist and they
  // point at different places (so the user can still reach the repo).
  const secondaryHomepage =
    homepage && registryPageUrl && stripTrailingSlash(homepage) !== stripTrailingSlash(registryPageUrl)
      ? homepage
      : null;

  return (
    <div
      className={clsx(
        "group relative flex h-full flex-col rounded-xl bg-elevated overflow-hidden",
        "transition-all duration-200 ease-out",
        "hover:-translate-y-0.5",
        !accent &&
          "border border-default hover:border-strong hover:shadow-lg hover:shadow-black/20",
        accent === "green" && [
          "border border-default border-l-[3px] border-l-green-500/80",
          "hover:border-strong hover:shadow-lg hover:shadow-green-900/30",
        ],
        accent === "amber" && [
          "border border-default border-l-[3px] border-l-amber-500/80",
          "hover:border-strong hover:shadow-lg hover:shadow-amber-900/30",
        ],
        accent === "blue" && [
          "border border-default border-l-[3px] border-l-blue-600/80",
          "hover:border-strong hover:shadow-lg hover:shadow-blue-900/30",
        ],
        dimmed && "opacity-55",
      )}
    >
      {/* Header band with logo (Tabularium icon) or first-letter fallback. */}
      {showBand && (
        <div
          className={clsx(
            "relative flex h-14 shrink-0 items-center justify-center overflow-hidden",
            band.bg,
          )}
        >
          {/* Subtle radial highlight so the band reads as a "platform" surface, not a flat stripe. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-black/20" />
          {iconUrl ? (
            <img
              src={iconUrl}
              alt=""
              loading="lazy"
              className="relative h-10 w-10 object-contain drop-shadow-md"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <span
              className={clsx(
                "relative select-none text-4xl font-bold leading-none",
                band.text,
              )}
            >
              {name.trim().charAt(0).toUpperCase()}
            </span>
          )}
          {!!downloads && downloads > 0 && (
            <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/40 px-1.5 py-px text-[10px] font-medium text-white/80 backdrop-blur-sm">
              <Download size={9} />
              {formatCount(downloads)}
            </span>
          )}
        </div>
      )}

      {/* Pulsing update indicator */}
      {pulse && (
        <div
          className={clsx(
            "absolute z-10 flex h-2 w-2",
            showBand ? "top-1.5 right-1.5" : "top-2.5 right-2.5",
          )}
        >
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </div>
      )}

      <div className="flex flex-1 flex-col p-4 gap-2.5">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {primaryHref ? (
                <button
                  type="button"
                  onClick={() => openUrl(primaryHref)}
                  title={primaryHref}
                  className="inline-flex min-w-0 items-center gap-1 text-left text-sm font-semibold text-primary cursor-pointer hover:underline underline-offset-2"
                >
                  <span className="truncate">{name}</span>
                  <ExternalLink size={11} className="shrink-0 text-muted" />
                </button>
              ) : (
                <span className="block truncate text-sm font-semibold text-primary">
                  {name}
                </span>
              )}
              {secondaryHomepage && (
                <button
                  type="button"
                  onClick={() => openUrl(secondaryHomepage)}
                  title={secondaryHomepage}
                  aria-label={t("settings.plugins.openHomepage", {
                    defaultValue: "Open homepage",
                  })}
                  className="text-muted hover:text-primary cursor-pointer transition-colors"
                >
                  <Home size={11} />
                </button>
              )}
              {version && (
                <span className="shrink-0 rounded-md border border-default bg-base px-1.5 py-px font-mono text-[10px] text-muted">
                  v{version}
                </span>
              )}
            </div>
            {parsedAuthor && (
              <p className="mt-0.5 text-[10px] text-muted">
                {t("settings.plugins.by")}{" "}
                {parsedAuthor.url ?? homepage ? (
                  <button
                    type="button"
                    onClick={() => openUrl((parsedAuthor.url ?? homepage)!)}
                    className="cursor-pointer underline-offset-2 transition-colors hover:text-secondary hover:underline"
                  >
                    {parsedAuthor.name}
                  </button>
                ) : (
                  parsedAuthor.name
                )}
              </p>
            )}
          </div>
          {status && <div className="shrink-0 mt-0.5">{status}</div>}
        </div>

        <p className="text-xs leading-relaxed text-secondary line-clamp-2 flex-1">
          {description}
        </p>

        {meta && (
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
            {meta}
          </div>
        )}
      </div>

      <div className="flex min-h-11 items-center justify-end gap-2 border-t border-default bg-base/50 px-4 py-2.5">
        {actions}
      </div>
    </div>
  );
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

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
}: {
  options: VersionOption[];
  value: string;
  onChange: (v: string) => void;
  isDowngrade: boolean;
  label: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const updatePos = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({
        top: r.bottom + 4,
        left: r.left,
        minWidth: Math.max(r.width, 160),
      });
    }
  };

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
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          updatePos();
          setIsOpen((o) => !o);
        }}
        className={clsx(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] bg-surface-tertiary transition-colors cursor-pointer select-none",
          isDowngrade
            ? "border-amber-500/30 text-amber-400/80 hover:border-amber-500/60 hover:text-amber-400"
            : isOpen
              ? "border-blue-500/60 text-primary"
              : "border-surface-quaternary text-secondary hover:border-blue-500/50 hover:text-primary",
        )}
      >
        <RotateCcw size={9} />
        <span>{label}</span>
        <ChevronDown
          size={9}
          className={clsx(
            "transition-transform duration-150",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropRef}
            style={{
              top: pos.top,
              left: pos.left,
              minWidth: pos.minWidth,
            }}
            className="fixed z-[200] bg-elevated border border-strong rounded-lg shadow-xl overflow-hidden"
          >
            {options.map((opt) => (
              <button
                key={opt.version}
                type="button"
                onClick={() => {
                  onChange(opt.version);
                  setIsOpen(false);
                }}
                className={clsx(
                  "w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors",
                  opt.isInstalled
                    ? "bg-green-500/10 hover:bg-green-500/20"
                    : opt.version === value
                      ? "bg-surface-secondary"
                      : "hover:bg-surface-secondary",
                )}
              >
                <span className="w-3 shrink-0 flex items-center justify-center">
                  {opt.isInstalled && (
                    <Check size={10} className="text-green-400" />
                  )}
                </span>
                <span
                  className={clsx(
                    "font-mono",
                    opt.isInstalled ? "text-green-300" : "text-primary",
                  )}
                >
                  v{opt.version}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {opt.isInstalled && (
                    <span className="text-[9px] font-medium bg-green-500/20 text-green-400 px-1.5 py-px rounded">
                      installed
                    </span>
                  )}
                  {opt.isLatest && (
                    <span className="text-[9px] font-medium bg-blue-500/20 text-blue-400 px-1.5 py-px rounded">
                      latest
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ── Plugin toggle ── */

function PluginToggle({
  enabled,
  disabled,
  onToggle,
}: {
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={enabled ? "Disable plugin" : "Enable plugin"}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent",
        "transition-colors duration-200 ease-in-out",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        enabled ? "bg-blue-600" : "bg-surface-tertiary",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <span
        className={clsx(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow",
          "transition duration-200 ease-in-out",
          enabled ? "translate-x-4" : "translate-x-0",
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
  colorClass,
  bgClass,
  valueColorClass,
  glowClass,
}: {
  icon: ReactNode;
  value: number;
  label: string;
  colorClass: string;
  bgClass: string;
  valueColorClass?: string;
  glowClass?: string;
}) {
  return (
    <div
      className={clsx(
        "p-4 flex items-center gap-3 transition-colors",
        glowClass,
      )}
    >
      <div className={clsx("p-2.5 rounded-lg shrink-0", bgClass, colorClass)}>
        {icon}
      </div>
      <div className="min-w-0">
        <div
          className={clsx(
            "text-2xl font-bold leading-none tabular-nums",
            valueColorClass ?? "text-primary",
          )}
        >
          {value}
        </div>
        <div className="text-[10px] text-muted mt-1 leading-tight truncate">
          {label}
        </div>
      </div>
    </div>
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
  const { settings, updateSetting } = useSettings();
  const {
    allDrivers,
    installedPlugins,
    refresh: refreshDrivers,
  } = useDrivers();
  const {
    plugins: registryPlugins,
    loading: registryLoading,
    error: registryError,
    refresh: refreshRegistry,
  } = usePluginRegistry();
  const { openConnectionIds, connectionDataMap, disconnect } = useDatabase();

  const [installingPluginId, setInstallingPluginId] = useState<string | null>(
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
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<AvailableFilter>("all");

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
  const updateCount = useMemo(
    () => registryPlugins.filter((plugin) => plugin.update_available).length,
    [registryPlugins],
  );

  const filteredPlugins = useMemo(() => {
    let list = registryPlugins;
    if (activeFilter === "all") {
      list = list.filter((p) => !p.installed_version);
    } else if (activeFilter === "installed") {
      list = list.filter((p) => !!p.installed_version);
    } else if (activeFilter === "updates") {
      list = list.filter((p) => p.update_available);
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
  }, [registryPlugins, activeFilter, searchQuery]);

  // Refresh the catalogue + drivers when a deep-link install succeeds at
  // app level — without this the user has to manually click Refresh after
  // the confirm modal closes.
  useEffect(() => {
    let cleanup: UnlistenFn | null = null;
    let mounted = true;
    listen("tabularis://plugin-installed", () => {
      if (!mounted) return;
      refreshRegistry();
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
  }, [refreshRegistry, refreshDrivers]);

  useEffect(() => {
    invoke<Array<{ plugin_id: string; error: string }>>(
      "get_plugin_startup_errors",
    )
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
      try {
        await invoke("install_plugin", { pluginId, version });
        // The picked version is spent once installed. Keeping it would pin the
        // card to what's now on disk, which reads as neither "up to date" (it
        // isn't latest) nor updatable (it is installed) — and the picker hides
        // itself once only one other release is left, leaving no way out.
        setSelectedVersions((prev) => {
          if (!(pluginId in prev)) return prev;
          const next = { ...prev };
          delete next[pluginId];
          return next;
        });
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
        setPluginInstallError({
          pluginId,
          error: String(err),
          operation: "install",
        });
      } finally {
        setInstallingPluginId(null);
      }
    },
    [refreshRegistry, refreshDrivers, onPluginsChanged, registryPlugins],
  );

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
            await invoke("uninstall_plugin", { pluginId });
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
    ],
  );

  const doToggle = useCallback(
    async (pluginId: string, pluginName: string, isEnabled: boolean) => {
      try {
        if (isEnabled) {
          await invoke("disable_plugin", { pluginId });
          await updateSetting(
            "activeExternalDrivers",
            activeExternalDrivers.filter((id) => id !== pluginId),
          );
        } else {
          await invoke("enable_plugin", { pluginId });
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
    [activeExternalDrivers, updateSetting, refreshDrivers],
  );

  return (
    <>
      <div className="space-y-8">
        {/* Overview panel */}
        <div className="rounded-lg border border-default bg-elevated overflow-hidden">
          <div className="p-5 border-b border-default bg-surface-secondary/50">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
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
              <button
                onClick={() => refreshRegistry()}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-default bg-base text-xs text-secondary hover:text-primary hover:border-strong transition-colors"
              >
                <RefreshCw size={13} />
                {t("settings.plugins.refresh")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-default">
            <StatCard
              icon={<PackageCheck size={15} />}
              value={installedPlugins.length}
              label={t("settings.plugins.installedMetric")}
              colorClass="text-green-400"
              bgClass="bg-green-500/10"
            />
            <StatCard
              icon={<Power size={15} />}
              value={externalDrivers.length}
              label={t("settings.plugins.enabledMetric")}
              colorClass="text-blue-400"
              bgClass="bg-blue-500/10"
            />
            <StatCard
              icon={<Boxes size={15} />}
              value={registryPlugins.length}
              label={t("settings.plugins.registryMetric")}
              colorClass="text-purple-400"
              bgClass="bg-purple-500/10"
            />
            <StatCard
              icon={<RefreshCw size={15} />}
              value={updateCount}
              label={t("settings.plugins.updatesMetric")}
              colorClass={updateCount > 0 ? "text-amber-400" : "text-muted"}
              bgClass={
                updateCount > 0 ? "bg-amber-500/10" : "bg-surface-secondary"
              }
              valueColorClass={updateCount > 0 ? "text-amber-400" : undefined}
              glowClass={
                updateCount > 0 ? "bg-amber-500/[0.04]" : undefined
              }
            />
          </div>
        </div>

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
              <input
                type="text"
                placeholder={t("settings.plugins.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-44 rounded-lg border border-default bg-base py-1.5 pl-7 pr-3 text-xs text-primary placeholder:text-muted transition-all focus:w-56 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center justify-between border-b border-default">
            <div className="flex items-center gap-0.5">
              {(
                [
                  {
                    id: "all" as const,
                    label: t("settings.plugins.filterAll"),
                    count: registryPlugins.filter((p) => !p.installed_version)
                      .length,
                  },
                  {
                    id: "installed" as const,
                    label: t("settings.plugins.filterInstalled"),
                    count:
                      allDrivers.length +
                      installedPlugins.filter(
                        (p) => !allDrivers.some((d) => d.id === p.id),
                      ).length,
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
                      ? "border-blue-500 text-primary"
                      : "border-transparent text-muted hover:text-secondary",
                  )}
                >
                  {label}
                  {count > 0 && (
                    <span
                      className={clsx(
                        "rounded-full px-1.5 py-px text-[9px] font-semibold",
                        id === "updates" && count > 0
                          ? "bg-amber-500/20 text-amber-400"
                          : "bg-surface-secondary text-muted",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => refreshRegistry()}
              className="mb-px flex items-center gap-1 text-xs text-muted transition-colors hover:text-primary"
            >
              <RefreshCw size={12} />
              {t("settings.plugins.refresh")}
            </button>
          </div>

          <div className="pt-4">
            {activeFilter === "installed" ? (
              /* ── Installed tab ── */
              (() => {
                const sq = searchQuery.toLowerCase().trim();
                const activeDrivers = sq
                  ? allDrivers.filter(
                      (d) =>
                        d.name.toLowerCase().includes(sq) ||
                        d.description.toLowerCase().includes(sq),
                    )
                  : allDrivers;
                const disabledPlugins = installedPlugins
                  .filter((p) => !allDrivers.some((d) => d.id === p.id))
                  .filter(
                    (p) =>
                      !sq ||
                      p.name.toLowerCase().includes(sq) ||
                      p.description.toLowerCase().includes(sq),
                  );
                const isEmpty = activeDrivers.length === 0 && disabledPlugins.length === 0;
                return (
                  <div className="grid gap-4 xl:grid-cols-2 lg:grid-cols-2 sm:grid-cols-1">
                    {activeDrivers.map((driver: PluginManifest) => {
                      const isBuiltin = driver.is_builtin === true;
                      const hasSettings = (driver.settings?.length ?? 0) > 0;
                      const registryPlugin = registryPlugins.find(
                        (p) => p.id === driver.id,
                      );
                      const canUpdate =
                        !isBuiltin &&
                        canUpdateToLatest(registryPlugin, APP_VERSION);
                      const isEnabled =
                        isBuiltin || activeExternalDrivers.includes(driver.id);
                      const accent: CardAccent = isBuiltin
                        ? null
                        : isEnabled
                          ? "blue"
                          : null;
                      const statusNode = isBuiltin ? (
                        <span className="text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-px rounded-md">
                          Built-in
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
                          accent={accent}
                          status={statusNode}
                          actions={
                            <div className="flex items-center justify-end gap-3 w-full">
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
                                  className="p-1.5 text-secondary hover:text-primary transition-colors"
                                  title={t(
                                    "settings.plugins.pluginSettings.title",
                                  )}
                                >
                                  <SettingsIcon size={15} />
                                </button>
                              )}
                              {canUpdate && registryPlugin && (
                                <button
                                  onClick={() =>
                                    doInstall(
                                      driver.id,
                                      registryPlugin.latest_version,
                                    )
                                  }
                                  disabled={installingPluginId === driver.id}
                                  className="flex items-center gap-1 text-[11px] text-green-500/80 hover:text-green-400 disabled:opacity-50 transition-colors"
                                >
                                  {installingPluginId === driver.id ? (
                                    <Loader2
                                      size={11}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <RefreshCw size={11} />
                                  )}
                                  {`${t("settings.plugins.update")} v${registryPlugin.latest_version}`}
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
                                  className="flex items-center gap-1 text-[11px] text-red-500/70 hover:text-red-400 disabled:opacity-50 transition-colors"
                                >
                                  {uninstallingPluginId === driver.id ? (
                                    <Loader2 size={11} className="animate-spin" />
                                  ) : (
                                    <Trash2 size={11} />
                                  )}
                                  {t("settings.plugins.remove")}
                                </button>
                              )}
                            </div>
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
                          accent={null}
                          status={
                            <PluginToggle
                              enabled={false}
                              onToggle={async () => {
                                try {
                                  await invoke("enable_plugin", {
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
                          actions={
                            <div className="flex items-center justify-end gap-3 w-full">
                              <SlotAnchor
                                name="settings.plugin.actions"
                                context={{ targetPluginId: plugin.id }}
                                className="flex items-center gap-1"
                              />
                              <button
                                onClick={() =>
                                  handleOpenPluginSettings(plugin.id)
                                }
                                className="p-1.5 text-secondary hover:text-primary transition-colors"
                                title={t(
                                  "settings.plugins.pluginSettings.title",
                                )}
                              >
                                <SettingsIcon size={15} />
                              </button>
                              <button
                                onClick={() =>
                                  doRemove(plugin.id, plugin.name)
                                }
                                disabled={uninstallingPluginId === plugin.id}
                                className="flex items-center gap-1 text-[11px] text-red-500/70 hover:text-red-400 disabled:opacity-50 transition-colors"
                              >
                                {uninstallingPluginId === plugin.id ? (
                                  <Loader2 size={11} className="animate-spin" />
                                ) : (
                                  <Trash2 size={11} />
                                )}
                                {t("settings.plugins.remove")}
                              </button>
                            </div>
                          }
                        />
                      );
                    })}

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
                  <div className="bg-red-900/20 border border-red-900/50 text-red-400 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                    <AlertTriangle size={16} />
                    {t("settings.plugins.registryError")}: {registryError}
                  </div>
                )}

                {!registryLoading && !registryError && (
                  <div className="grid gap-4 xl:grid-cols-2 lg:grid-cols-2 sm:grid-cols-1">
                    {filteredPlugins.map((plugin) => {
                  const platformReleases = plugin.releases.filter(
                    (r) => r.platform_supported,
                  );
                  const installableReleases = platformReleases.filter(
                    (r) => r.version !== plugin.installed_version,
                  );
                  const isAtLatest =
                    !!plugin.installed_version &&
                    plugin.installed_version === plugin.latest_version;
                  const defaultVer = isAtLatest
                    ? plugin.latest_version
                    : (installableReleases.find(
                        (r) => r.version === plugin.latest_version,
                      )?.version ??
                      installableReleases[0]?.version ??
                      plugin.latest_version);
                  const selectedVer =
                    selectedVersions[plugin.id] ?? defaultVer;
                  const selectedRelease = plugin.releases.find(
                    (r) => r.version === selectedVer,
                  );
                  const selectedPlatformSupported =
                    selectedRelease?.platform_supported ?? false;
                  const isSelectedInstalled =
                    plugin.installed_version === selectedVer;
                  const minVersion =
                    selectedRelease?.min_tabularis_version ?? null;
                  const isCompatible =
                    !minVersion || versionGte(APP_VERSION, minVersion);
                  const isUpdate =
                    !!plugin.installed_version && !isSelectedInstalled;
                  const isDowngrade =
                    isUpdate &&
                    !versionGte(selectedVer, plugin.installed_version!);
                  const showVersionPicker = isAtLatest
                    ? installableReleases.length >= 1
                    : installableReleases.length > 1;

                  const accent: CardAccent = plugin.update_available
                    ? "amber"
                    : plugin.installed_version
                      ? "green"
                      : null;

                  const installedBadge = plugin.installed_version ? (
                    <span
                      className={clsx(
                        "text-[10px] font-medium px-1.5 py-px rounded-md border",
                        plugin.update_available
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                          : "bg-green-500/10 text-green-400 border-green-500/25",
                      )}
                    >
                      {t("settings.plugins.installed")} v
                      {plugin.installed_version}
                    </span>
                  ) : undefined;

                  // Tags + kind chips from the Tabularium catalogue. Kind is
                  // shown as a distinct pill since it drives admin taxonomies;
                  // remaining tags become muted chips.
                  const remainingTags = (plugin.tags ?? []).filter(
                    (t) => t && t !== plugin.kind,
                  );
                  const tagMeta =
                    plugin.kind || remainingTags.length > 0 ? (
                      <>
                        {plugin.kind && (
                          <span className="rounded-md border border-blue-700/30 bg-blue-900/20 px-1.5 py-px text-blue-300">
                            {plugin.kind}
                          </span>
                        )}
                        {remainingTags.slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md border border-default bg-base px-1.5 py-px"
                          >
                            {tag}
                          </span>
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
                      key={plugin.id}
                      name={plugin.name}
                      description={plugin.description}
                      author={plugin.author}
                      homepage={plugin.homepage}
                      registryPageUrl={registryPageUrl}
                      iconUrl={plugin.icon}
                      downloads={plugin.downloads}
                      accent={accent}
                      pulse={plugin.update_available}
                      showBand
                      status={installedBadge}
                      meta={tagMeta}
                      actions={
                        !selectedPlatformSupported ? (
                          <span className="text-xs text-muted italic text-right">
                            {t("settings.plugins.platformNotSupported")}
                          </span>
                        ) : (
                          <>
                            {isSelectedInstalled &&
                              selectedVer === plugin.latest_version && (
                                <div className="flex items-center justify-center gap-1.5">
                                  <CheckCircle2
                                    size={12}
                                    className="text-green-400"
                                  />
                                  <span className="text-xs text-green-400 font-medium">
                                    {t("settings.plugins.upToDate")}
                                  </span>
                                </div>
                              )}

                            {!isSelectedInstalled &&
                              (isCompatible ? (
                                <button
                                  onClick={() =>
                                    doInstall(plugin.id, selectedVer)
                                  }
                                  disabled={
                                    installingPluginId === plugin.id
                                  }
                                  className={`w-full flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium text-white transition-colors disabled:opacity-50 ${
                                    isDowngrade
                                      ? "bg-amber-600 hover:bg-amber-500"
                                      : isUpdate
                                        ? "bg-green-600 hover:bg-green-500"
                                        : "bg-blue-600 hover:bg-blue-500"
                                  }`}
                                >
                                  {installingPluginId === plugin.id ? (
                                    <Loader2
                                      size={12}
                                      className="animate-spin"
                                    />
                                  ) : isDowngrade ? (
                                    <RotateCcw size={12} />
                                  ) : isUpdate ? (
                                    <RefreshCw size={12} />
                                  ) : (
                                    <Download size={12} />
                                  )}
                                  {isDowngrade
                                    ? `${t("settings.plugins.downgrade")} v${selectedVer}`
                                    : isUpdate
                                      ? `${t("settings.plugins.update")} v${selectedVer}`
                                      : `${t("settings.plugins.install")} v${selectedVer}`}
                                </button>
                              ) : (
                                <div className="w-full flex flex-col items-end gap-1">
                                  <button
                                    disabled
                                    title={t(
                                      "settings.plugins.requiresVersion",
                                      { version: minVersion },
                                    )}
                                    className="w-full flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium text-muted bg-surface-tertiary cursor-not-allowed opacity-50"
                                  >
                                    <Download size={12} />
                                    {t("settings.plugins.install")} v
                                    {selectedVer}
                                  </button>
                                  <span className="text-[10px] text-amber-400/80 text-right">
                                    {t("settings.plugins.requiresVersion", {
                                      version: minVersion,
                                    })}
                                  </span>
                                </div>
                              ))}

                            {showVersionPicker &&
                              (() => {
                                const dropdownOptions: VersionOption[] = [
                                  ...(isAtLatest
                                    ? [
                                        {
                                          version: plugin.latest_version!,
                                          isInstalled: true,
                                          isLatest: true,
                                        },
                                      ]
                                    : []),
                                  ...[...installableReleases]
                                    .reverse()
                                    .map((r) => ({
                                      version: r.version,
                                      isInstalled: false,
                                      isLatest:
                                        r.version === plugin.latest_version,
                                    })),
                                ];
                                return (
                                  <VersionDropdown
                                    options={dropdownOptions}
                                    value={selectedVer}
                                    onChange={(v) =>
                                      setSelectedVersions((prev) => ({
                                        ...prev,
                                        [plugin.id]: v,
                                      }))
                                    }
                                    isDowngrade={isDowngrade}
                                    label={
                                      isAtLatest && isSelectedInstalled
                                        ? t("settings.plugins.olderVersions")
                                        : `v${selectedVer}`
                                    }
                                  />
                                );
                              })()}
                          </>
                        )
                      }
                    />
                  );
                })}

                {filteredPlugins.length === 0 && registryPlugins.length > 0 && (
                  <p className="col-span-full text-sm text-muted py-4">
                    {t("settings.plugins.searchNoResults")}
                  </p>
                )}
                {registryPlugins.length === 0 && (
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
          onClick={() => openUrl("https://tabularium.wiki")}
          className="ml-1 inline-flex items-center gap-1 text-primary cursor-pointer hover:underline underline-offset-2"
        >
          Tabularium
          <ExternalLink size={11} />
        </button>
      </div>

      {/* Modals */}
      <PluginInstallErrorModal
        isOpen={pluginInstallError !== null}
        onClose={() => setPluginInstallError(null)}
        pluginId={pluginInstallError?.pluginId ?? ""}
        error={pluginInstallError?.error ?? ""}
        operation={pluginInstallError?.operation ?? "install"}
      />
      <PluginRemoveModal
        isOpen={pluginRemoveConfirm !== null}
        onClose={() => setPluginRemoveConfirm(null)}
        pluginName={pluginRemoveConfirm?.pluginName ?? ""}
        onConfirm={() => pluginRemoveConfirm?.onConfirm()}
      />
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
