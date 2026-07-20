import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Check,
  AlertCircle,
  ArrowLeft,
  Loader2,
  Database,
  Settings,
  XCircle,
  FolderOpen,
  CheckSquare,
  Square,
  Plug,
  Eye,
  EyeOff,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectionAppearance } from "../../contexts/DatabaseContext";
import { AppearanceSection } from "./NewConnectionModal/AppearanceSection";
import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { SshConnectionsModal } from "./SshConnectionsModal";
import { K8sConnectionsModal } from "./K8sConnectionsModal";
import { Select } from "../ui/Select";
import { SlotAnchor } from "../ui/SlotAnchor";
import { useDrivers } from "../../hooks/useDrivers";
import { useSettings } from "../../hooks/useSettings";
import { usePluginSlotRegistry } from "../../hooks/usePluginSlotRegistry";
import { Modal } from "../ui/Modal";
import { SqlEditorWrapper } from "../ui/SqlEditorWrapper";
import { loadSshConnections, type SshConnection } from "../../utils/ssh";
import {
  loadK8sConnections,
  getK8sContexts,
  getK8sNamespaces,
  getK8sResources,
  getK8sResourcePorts,
  type K8sCommandOptions,
  type K8sConnection,
} from "../../utils/k8s";
import { useK8sPathOverrides } from "../../hooks/useK8sPathOverrides";
import { useLatestAsync } from "../../hooks/useLatestAsync";
import { K8sAdvancedSettings } from "../ui/K8sAdvancedSettings";
import { isMultiDatabaseCapable } from "../../utils/database";
import { toErrorMessage } from "../../utils/errors";
import { fetchConnectionWithCredentials } from "../../utils/credentials";
import { getDriverIcon, getDriverColorStyle } from "../../utils/driverUI";
import {
  parseConnectionString,
  toConnectionParams,
} from "../../utils/connectionStringParser";
import { useConnectionCatalogue } from "../../hooks/useConnectionCatalogue";
import { ConnectionCatalogue } from "./connection/ConnectionCatalogue";
import { DriverVersionPicker } from "./connection/DriverVersionPicker";
import { InstallGate } from "./connection/InstallGate";
import {
  resolveEngineSelection,
  type EngineGroup,
  type CatalogueDriver,
} from "../../utils/connectionCatalogue";

// Accent colors per data paradigm, used for driver chips in the configure header.
const PARADIGM_ACCENT: Record<string, string> = {
  sql: "#3b82f6",
  relational: "#3b82f6",
  nosql: "#10b981",
  document: "#10b981",
  "key-value": "#14b8a6",
  vector: "#a855f7",
  graph: "#f59e0b",
  timeseries: "#ec4899",
  search: "#6366f1",
};

const paradigmAccent = (p: string): string => PARADIGM_ACCENT[p] ?? "#64748b";

interface ConnectionParams {
  driver: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database: string | string[];
  ssl_mode?: string;
  ssl_ca?: string;
  ssl_cert?: string;
  ssl_key?: string;
  // MySQL/MariaDB: mysql_clear_password (cleartext) auth plugin (TLS required)
  enable_cleartext_plugin?: boolean;
  // MySQL: force PIPES_AS_CONCAT / NO_ENGINE_SUBSTITUTION sql_mode on connect.
  // Defaults to true; disable for Vitess/PlanetScale which reject altering sql_mode.
  pipes_as_concat?: boolean;
  // SSH
  ssh_enabled?: boolean;
  ssh_connection_id?: string;
  // Legacy SSH fields (for backward compatibility)
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_password?: string;
  ssh_key_file?: string;
  ssh_key_passphrase?: string;
  ssh_allow_passphrase_prompt?: boolean;
  save_in_keychain?: boolean;
  // K8s
  k8s_enabled?: boolean;
  k8s_connection_id?: string;
  k8s_context?: string;
  k8s_namespace?: string;
  k8s_resource_type?: string;
  k8s_resource_name?: string;
  k8s_port?: number;
  k8s_kubectl_path?: string;
  k8s_kubeconfig_path?: string;
  // SQL run on every new connection (e.g. SET / set_config)
  startup_script?: string;
}

interface SavedConnection {
  id: string;
  name: string;
  params: ConnectionParams;
  detect_json_in_text_columns?: boolean;
  appearance?: ConnectionAppearance;
}

interface NewConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  initialConnection?: SavedConnection | null;
}

interface K8sDiscoveryErrors {
  contexts: string | null;
  namespaces: string | null;
  resources: string | null;
}

type K8sDiscoverySource = keyof K8sDiscoveryErrors;

type InlineK8sPathCheck =
  | { allowed: true; options?: K8sCommandOptions }
  | { allowed: false; reason: "invalid" | "applied" };

function hasK8sCommandOverrides(options: K8sCommandOptions): boolean {
  return (
    options.kubectl_path !== undefined || options.kubeconfig_path !== undefined
  );
}

const FieldInput = ({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoFocus,
  className,
}: {
  label: string;
  value: string | number | undefined;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";

  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
        {label}
      </label>
      <div className="relative group">
        <input
          type={isPassword ? (showPassword ? "text" : "password") : type}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          className={clsx(
            "w-full px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted placeholder:italic focus:border-blue-500 focus:outline-none transition-colors",
            isPassword && "pr-10"
          )}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-primary transition-colors focus:outline-none"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
    </div>
  );
};

export const NewConnectionModal = ({
  isOpen,
  onClose,
  onSave,
  initialConnection,
}: NewConnectionModalProps) => {
  const { t } = useTranslation();
  const { drivers, refresh: refreshDrivers } = useDrivers();
  const { settings, updateSetting } = useSettings();
  const { invalidate: invalidateK8sAsync, run: runK8sAsync } = useLatestAsync();

  // ── wizard step ──
  const isEditing = Boolean(initialConnection);
  const [step, setStep] = useState<"catalogue" | "form">(
    isEditing ? "form" : "catalogue",
  );
  const [pendingGroup, setPendingGroup] = useState<EngineGroup | null>(null);
  const catalogue = useConnectionCatalogue();

  // ── form state ──
  const [driver, setDriver] = useState<string>("mysql");
  const activeDriver = drivers.find((d) => d.id === driver) ?? drivers[0];

  // ── driver install state ──
  const [installStatus, setInstallStatus] = useState<
    "idle" | "installing" | "error"
  >("idle");
  const [installError, setInstallError] = useState<string | undefined>();

  const installDriver = async (
    slug: string,
    version: string,
  ): Promise<boolean> => {
    setInstallStatus("installing");
    setInstallError(undefined);
    try {
      await invoke("install_plugin", { pluginId: slug, version });
      // install_plugin hot-registers the driver, but the connection modal only
      // surfaces external drivers that are in `activeExternalDrivers`. Installing
      // from the catalogue is an explicit opt-in, so activate it — otherwise the
      // freshly-installed driver is filtered out and selection falls back to a
      // built-in (mysql).
      await updateSetting(
        "activeExternalDrivers",
        Array.from(new Set([...(settings.activeExternalDrivers ?? []), slug])),
      );
      catalogue.refresh();
      refreshDrivers();
      setInstallStatus("idle");
      return true;
    } catch (e) {
      setInstallStatus("error");
      setInstallError(
        typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e),
      );
      return false;
    }
  };

  const activeCatalogueDriver =
    catalogue.groups
      .flatMap((g) => g.drivers)
      .find((d) => d.slug === driver) ?? null;
  const activeDriverNotInstalled =
    activeCatalogueDriver != null && !activeCatalogueDriver.installed;

  // Accent + glyph for the active driver, preferring the registry's icon URL
  // (the real plugin logo) and falling back to the built-in driver glyph.
  const driverAccent =
    activeCatalogueDriver?.color ||
    paradigmAccent(activeCatalogueDriver?.paradigms?.[0] ?? "") ||
    "#64748b";
  const renderDriverGlyph = (size: number) => {
    const icon = activeCatalogueDriver?.icon ?? activeDriver?.icon ?? "";
    if (/^https?:\/\//.test(icon) || icon.startsWith("data:")) {
      return (
        <img
          src={icon}
          alt=""
          className="h-full w-full rounded-[inherit] object-contain p-1.5"
        />
      );
    }
    return getDriverIcon(activeDriver, size);
  };
  const [name, setName] = useState("");
  const [formData, setFormData] = useState<Partial<ConnectionParams>>({
    host: "localhost",
    port: 3306,
    username: "",
    database: "",
    ssl_mode: "",
    ssh_enabled: false,
    ssh_port: 22,
    k8s_enabled: false,
  });
  const [selectedDatabasesState, setSelectedDatabasesState] = useState<
    string[]
  >([]);
  const [dbSearchQuery, setDbSearchQuery] = useState("");
  const [detectJsonInTextColumns, setDetectJsonInTextColumns] = useState(false);
  const [passwordDirty, setPasswordDirty] = useState(false);
  const [sshPasswordDirty, setSshPasswordDirty] = useState(false);
  const [connectionString, setConnectionString] = useState("");
  const [connectionStringError, setConnectionStringError] = useState<
    string | null
  >(null);

  // ── tab ──
  const [activeTab, setActiveTab] = useState<
    "general" | "databases" | "ssh" | "ssl" | "k8s" | "advanced" | "appearance"
  >("general");

  // ── Tab bar horizontal scroll affordance ──
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [tabFade, setTabFade] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  const updateTabFade = useCallback(() => {
    const el = tabBarRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setTabFade({
      left: scrollLeft > 1,
      right: scrollLeft + clientWidth < scrollWidth - 1,
    });
  }, []);

  // Recompute fades when the visible tab set changes and keep the active tab
  // scrolled into view; also follow window resizes.
  useLayoutEffect(() => {
    updateTabFade();
    const el = tabBarRef.current;
    const activeEl = el?.querySelector<HTMLElement>('[data-active="true"]');
    if (el && activeEl) {
      const left = activeEl.offsetLeft;
      const right = left + activeEl.offsetWidth;
      if (left < el.scrollLeft) {
        el.scrollTo({ left: left - 20, behavior: "smooth" });
      } else if (right > el.scrollLeft + el.clientWidth) {
        el.scrollTo({ left: right - el.clientWidth + 20, behavior: "smooth" });
      }
    }
    window.addEventListener("resize", updateTabFade);
    return () => window.removeEventListener("resize", updateTabFade);
  }, [updateTabFade, driver, activeTab, selectedDatabasesState.length]);

  // Step the tab strip left/right (used by the edge arrows).
  const scrollTabs = useCallback((dir: -1 | 1) => {
    const el = tabBarRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: "smooth" });
  }, []);

  // ── SSH ──
  const [sshConnections, setSshConnections] = useState<SshConnection[]>([]);
  const [isSshModalOpen, setIsSshModalOpen] = useState(false);
  const [sshMode, setSshMode] = useState<"existing" | "inline">("existing");

  // ── K8s ──
  const [k8sConnections, setK8sConnections] = useState<K8sConnection[]>([]);
  const [isK8sModalOpen, setIsK8sModalOpen] = useState(false);
  const [k8sMode, setK8sMode] = useState<"existing" | "inline">("existing");
  const [k8sAutoPort, setK8sAutoPort] = useState<{
    context: string;
    namespace: string;
    resourceType: string;
    resourceName: string;
    port: number;
  } | null>(null);
  const [k8sContexts, setK8sContexts] = useState<string[]>([]);
  const [k8sNamespaces, setK8sNamespaces] = useState<string[]>([]);
  const [k8sResources, setK8sResources] = useState<string[]>([]);
  const [k8sDiscoveryErrors, setK8sDiscoveryErrors] =
    useState<K8sDiscoveryErrors>({
      contexts: null,
      namespaces: null,
      resources: null,
    });
  const [k8sPathActionError, setK8sPathActionError] = useState<string | null>(
    null,
  );
  const [k8sSelectionError, setK8sSelectionError] = useState<string | null>(
    null,
  );
  const inlineK8sActiveRef = useRef(false);
  const inlineK8sTestActiveRef = useRef(false);
  const inlineK8sTestSequenceRef = useRef(0);

  // ── databases ──
  const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [databaseLoadError, setDatabaseLoadError] = useState<string | null>(
    null,
  );

  // ── connection test ──
  const [status, setStatus] = useState<
    "idle" | "testing" | "saving" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [testResult, setTestResult] = useState<"success" | "error" | null>(
    null,
  );
  const [isActionPending, setIsActionPending] = useState(false);
  const [isPersistencePending, setIsPersistencePending] = useState(false);
  const actionSequenceRef = useRef(0);
  const activeActionRef = useRef<number | null>(null);
  const persistenceActionRef = useRef<number | null>(null);
  const initSequenceRef = useRef(0);

  const beginFormAction = useCallback((): number | null => {
    if (
      activeActionRef.current !== null ||
      persistenceActionRef.current !== null
    ) {
      return null;
    }

    const actionId = ++actionSequenceRef.current;
    activeActionRef.current = actionId;
    setIsActionPending(true);
    return actionId;
  }, []);

  const finishFormAction = useCallback((actionId: number) => {
    if (activeActionRef.current !== actionId) return;
    activeActionRef.current = null;
    setIsActionPending(false);
  }, []);

  // ── validation errors ──
  const [nameError, setNameError] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [databasesTabError, setDatabasesTabError] = useState(false);

  // ── appearance ──
  const [appearance, setAppearance] = useState<ConnectionAppearance>(
    initialConnection?.appearance ?? {},
  );
  // Stable UUID used as connectionId for icon uploads on new connections.
  // The backend mints its own id on save_connection, so we use this temp id
  // for the icon filename. After save, set_connection_appearance persists the
  // appearance (including the icon path which refs this temp id) under the
  // real connection id. Because cascade_delete_if_image uses the stored path
  // directly, cleanup works correctly despite the temp-id prefix in the filename.
  const generatedId = useMemo(() => crypto.randomUUID(), []);
  const effectiveConnectionId = initialConnection?.id ?? generatedId;

  // ── orphan-icon cleanup on cancel ──
  // Mirror appearance into a ref so the unmount cleanup can read the latest value
  // without being re-registered on every render (empty-deps effect).
  const appearanceRef = useRef(appearance);
  useEffect(() => { appearanceRef.current = appearance; }, [appearance]);

  // Track whether the modal was successfully saved; if not, delete any
  // images that were uploaded during this session but not committed.
  const wasSavedRef = useRef(false);
  const originalImagePath = useRef<string | null>(
    initialConnection?.appearance?.icon?.type === "image"
      ? initialConnection.appearance.icon.path
      : null,
  );
  // All icon paths uploaded during this modal session (may include superseded picks).
  const uploadedPathsRef = useRef<string[]>([]);

  const handleImageUploaded = useCallback((path: string) => {
    uploadedPathsRef.current.push(path);
  }, []);

  useEffect(() => {
    // Reset on each open so re-opening the modal starts fresh.
    wasSavedRef.current = false;
    uploadedPathsRef.current = [];
    originalImagePath.current =
      initialConnection?.appearance?.icon?.type === "image"
        ? initialConnection.appearance.icon.path
        : null;

    return () => {
      if (
        wasSavedRef.current ||
        persistenceActionRef.current !== null
      ) {
        return;
      }
      // On cancel: delete EVERY path uploaded this session except the original
      // (the one the modal opened with). Handles "pick A then B then C then cancel".
      const original = originalImagePath.current;
      const toDelete = uploadedPathsRef.current.filter(p => p !== original);
      toDelete.forEach(p =>
        invoke("delete_connection_icon", { relativePath: p }).catch(() => {})
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── capabilities ──
  const noConnectionRequired =
    activeDriver?.capabilities?.no_connection_required === true;
  const isNetworkDriver =
    !noConnectionRequired &&
    activeDriver?.capabilities?.file_based === false &&
    !activeDriver?.capabilities?.folder_based;
  const k8sDefaultPort = activeDriver?.default_port ?? undefined;
  // Derive K8s ports instead of seeding formData so edit flows with no saved port are covered.
  const getK8sAutoPort = (params: Partial<ConnectionParams>) =>
    k8sAutoPort &&
    params.k8s_context === k8sAutoPort.context &&
    params.k8s_namespace === k8sAutoPort.namespace &&
    params.k8s_resource_type === k8sAutoPort.resourceType &&
    params.k8s_resource_name === k8sAutoPort.resourceName
      ? k8sAutoPort.port
      : undefined;
  const resolveK8sPort = (params: Partial<ConnectionParams>) =>
    params.k8s_enabled && k8sMode === "inline"
      ? params.k8s_port ?? getK8sAutoPort(params) ?? k8sDefaultPort
      : params.k8s_port;
  const effectiveK8sPort = resolveK8sPort(formData);
  const connectionStringEnabled =
    activeDriver?.capabilities?.connection_string ??
    activeDriver?.capabilities?.connectionString ??
    true;
  const connectionStringPlaceholder =
    activeDriver?.capabilities?.connection_string_example?.trim() ||
    activeDriver?.capabilities?.connectionStringExample?.trim() ||
    t("newConnection.connectionStringPlaceholder", {
      defaultValue: "e.g. mysql://user:pass@localhost:3306/db",
    });
  const isMultiDb = isMultiDatabaseCapable(activeDriver?.capabilities);
  // Flat single-database store (e.g. Meilisearch): no database to select or name.
  const singleDatabase =
    activeDriver?.capabilities?.single_database === true;

  // ── plugin slot: connection-modal.connection_content ──
  const slotRegistry = usePluginSlotRegistry();
  const onDatabaseChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, database: value }));
  }, []);
  const dbFieldSlotContext = useMemo(
    () => ({
      driver,
      database: typeof formData.database === "string" ? formData.database : "",
      onDatabaseChange,
      connectionName: name,
    }),
    [driver, formData.database, onDatabaseChange, name],
  );
  const hasConnectionContentSlot =
    noConnectionRequired &&
    slotRegistry.getSlotContributions(
      "connection-modal.connection_content",
      dbFieldSlotContext,
    ).length > 0;

  // ── helpers ──
  const loadSshConnectionsList = async () => {
    const result = await loadSshConnections();
    setSshConnections(result);
  };

  const loadK8sConnectionsList = async () => {
    const result = await loadK8sConnections();
    setK8sConnections(result);
  };

  const setK8sDiscoveryError = useCallback(
    (source: K8sDiscoverySource, error: string | null) => {
      setK8sDiscoveryErrors((previous) =>
        previous[source] === error ? previous : { ...previous, [source]: error },
      );
    },
    [],
  );

  const invalidateK8sDiscovery = useCallback(() => {
    invalidateK8sAsync("new-k8s-contexts");
    invalidateK8sAsync("new-k8s-namespaces");
    invalidateK8sAsync("new-k8s-resources");
    invalidateK8sAsync("new-k8s-ports");
  }, [invalidateK8sAsync]);

  const invalidateInlineK8sTest = useCallback(() => {
    invalidateK8sAsync("new-k8s-test");
    inlineK8sTestSequenceRef.current += 1;
    if (!inlineK8sTestActiveRef.current) return;

    inlineK8sTestActiveRef.current = false;
    setStatus("idle");
    setMessage("");
    setTestResult(null);
  }, [invalidateK8sAsync]);

  useEffect(() => {
    inlineK8sActiveRef.current =
      isOpen && formData.k8s_enabled === true && k8sMode === "inline";
  }, [formData.k8s_enabled, isOpen, k8sMode]);

  const loadK8sContextsList = useCallback(
    async (options: K8sCommandOptions) => {
      const result = await runK8sAsync("new-k8s-contexts", () =>
        hasK8sCommandOverrides(options)
          ? getK8sContexts(options)
          : getK8sContexts(),
      );
      if (result.status === "success") {
        setK8sContexts(result.value);
        setK8sDiscoveryError("contexts", null);
      } else if (result.status === "error") {
        setK8sContexts([]);
        setK8sDiscoveryError("contexts", toErrorMessage(result.error));
      }
    },
    [runK8sAsync, setK8sDiscoveryError],
  );

  const loadK8sNamespacesList = useCallback(
    async (context: string, options: K8sCommandOptions) => {
      const result = await runK8sAsync("new-k8s-namespaces", () =>
        hasK8sCommandOverrides(options)
          ? getK8sNamespaces(context, options)
          : getK8sNamespaces(context),
      );
      if (result.status === "success") {
        setK8sNamespaces(result.value);
        setK8sDiscoveryError("namespaces", null);
      } else if (result.status === "error") {
        setK8sNamespaces([]);
        setK8sDiscoveryError("namespaces", toErrorMessage(result.error));
      }
    },
    [runK8sAsync, setK8sDiscoveryError],
  );

  const loadK8sResourcesList = useCallback(
    async (
      context: string,
      namespace: string,
      resourceType: string,
      options: K8sCommandOptions,
    ) => {
      const result = await runK8sAsync("new-k8s-resources", () =>
        hasK8sCommandOverrides(options)
          ? getK8sResources(context, namespace, resourceType, options)
          : getK8sResources(context, namespace, resourceType),
      );
      if (result.status === "success") {
        setK8sResources(result.value);
        setK8sDiscoveryError("resources", null);
      } else if (result.status === "error") {
        setK8sResources([]);
        setK8sDiscoveryError("resources", toErrorMessage(result.error));
      }
    },
    [runK8sAsync, setK8sDiscoveryError],
  );

  const loadK8sResourcePorts = useCallback(
    async (
      context: string,
      namespace: string,
      resourceType: string,
      resourceName: string,
      options: K8sCommandOptions,
    ) => {
      const result = await runK8sAsync("new-k8s-ports", () =>
        hasK8sCommandOverrides(options)
          ? getK8sResourcePorts(
              context,
              namespace,
              resourceType,
              resourceName,
              options,
            )
          : getK8sResourcePorts(
              context,
              namespace,
              resourceType,
              resourceName,
            ),
      );
      if (result.status === "success") {
        setK8sAutoPort(
          result.value.length === 1
            ? {
                context,
                namespace,
                resourceType,
                resourceName,
                port: result.value[0],
              }
            : null,
        );
      }
    },
    [runK8sAsync],
  );

  const handleInlinePathsApplied = useCallback(
    (options: K8sCommandOptions) => {
      invalidateK8sDiscovery();
      invalidateInlineK8sTest();
      setFormData((previous) => ({
        ...previous,
        k8s_kubectl_path: options.kubectl_path,
        k8s_kubeconfig_path: options.kubeconfig_path,
        k8s_context: undefined,
        k8s_namespace: undefined,
        k8s_resource_type: undefined,
        k8s_resource_name: undefined,
        k8s_port: undefined,
      }));
      setK8sAutoPort(null);
      setK8sContexts([]);
      setK8sNamespaces([]);
      setK8sResources([]);
      setK8sDiscoveryErrors({ contexts: null, namespaces: null, resources: null });
      setK8sPathActionError(null);
      setK8sSelectionError(null);
      if (inlineK8sActiveRef.current) {
        void loadK8sContextsList(options);
      }
    },
    [invalidateInlineK8sTest, invalidateK8sDiscovery, loadK8sContextsList],
  );

  const pathOverrides = useK8sPathOverrides({
    onApplied: handleInlinePathsApplied,
    onDraftChanged: invalidateInlineK8sTest,
  });
  const {
    appliedOptions: appliedK8sOptions,
    ensureApplied: ensureK8sPathsApplied,
    cancelPending: cancelK8sPathValidation,
    initialize: initializeK8sPathOverrides,
    reset: resetK8sPathOverrides,
  } = pathOverrides;

  const actionSnapshot = useMemo(
    () => ({
      driver,
      name,
      formData,
      selectedDatabasesState,
      detectJsonInTextColumns,
      appearance,
      sshMode,
      k8sMode,
      effectiveK8sPort,
      isMultiDb,
      noConnectionRequired,
      initialConnection,
      kubectlPath: pathOverrides.kubectlPath,
      kubeconfigPath: pathOverrides.kubeconfigPath,
      appliedK8sOptions,
    }),
    [
      appearance,
      appliedK8sOptions,
      detectJsonInTextColumns,
      driver,
      effectiveK8sPort,
      formData,
      initialConnection,
      isMultiDb,
      k8sMode,
      name,
      noConnectionRequired,
      pathOverrides.kubeconfigPath,
      pathOverrides.kubectlPath,
      selectedDatabasesState,
      sshMode,
    ],
  );
  const actionSnapshotRef = useRef(actionSnapshot);
  useLayoutEffect(() => {
    actionSnapshotRef.current = actionSnapshot;
  }, [actionSnapshot]);

  const cancelInlineK8sWork = useCallback(() => {
    invalidateK8sDiscovery();
    invalidateK8sAsync("new-k8s-test");
    inlineK8sTestSequenceRef.current += 1;
    inlineK8sTestActiveRef.current = false;
    actionSequenceRef.current += 1;
    activeActionRef.current = null;
    initSequenceRef.current += 1;
    cancelK8sPathValidation();
  }, [cancelK8sPathValidation, invalidateK8sAsync, invalidateK8sDiscovery]);

  useEffect(() => {
    if (!isOpen) {
      cancelInlineK8sWork();
      queueMicrotask(() => {
        setIsActionPending(false);
        if (persistenceActionRef.current === null) {
          setIsPersistencePending(false);
        }
        setStatus("idle");
        setMessage("");
        setTestResult(null);
      });
    }
  }, [cancelInlineK8sWork, isOpen]);

  const handleClose = useCallback(() => {
    if (persistenceActionRef.current !== null) return;
    cancelInlineK8sWork();
    setIsActionPending(false);
    resetK8sPathOverrides();
    onClose();
  }, [cancelInlineK8sWork, onClose, resetK8sPathOverrides]);

  const ensureInlineK8sPaths = useCallback(async (): Promise<InlineK8sPathCheck> => {
    if (k8sMode !== "inline") {
      return { allowed: true };
    }
    if (!formData.k8s_enabled) {
      return { allowed: true, options: appliedK8sOptions };
    }

    const result = await ensureK8sPathsApplied();
    if (result.status === "invalid") {
      return { allowed: false, reason: "invalid" };
    }
    if (result.status === "applied") {
      return { allowed: false, reason: "applied" };
    }

    return { allowed: true, options: result.options };
  }, [
    appliedK8sOptions,
    ensureK8sPathsApplied,
    formData.k8s_enabled,
    k8sMode,
  ]);

  const preflightFormAction = useCallback(async () => {
    const actionId = beginFormAction();
    if (actionId === null) return null;
    const startingSnapshot = actionSnapshotRef.current;

    try {
      const inlinePaths = await ensureInlineK8sPaths();
      if (activeActionRef.current !== actionId) {
        finishFormAction(actionId);
        return null;
      }
      if (!inlinePaths.allowed && inlinePaths.reason === "applied") {
        setK8sPathActionError(t("k8sConnections.pathSelectionReset"));
        finishFormAction(actionId);
        return null;
      }
      if (actionSnapshotRef.current !== startingSnapshot) {
        finishFormAction(actionId);
        return null;
      }
      if (!inlinePaths.allowed) {
        setK8sPathActionError(t("k8sConnections.pathValidationFailed"));
        finishFormAction(actionId);
        return null;
      }

      setK8sPathActionError(null);
      return { actionId, startingSnapshot, inlinePaths };
    } catch (error) {
      finishFormAction(actionId);
      throw error;
    }
  }, [beginFormAction, ensureInlineK8sPaths, finishFormAction, t]);

  const withInlineK8sPaths = useCallback(
    (
      params: Partial<ConnectionParams>,
      options?: K8sCommandOptions,
    ): Partial<ConnectionParams> => {
      const next = { ...params };
      if (k8sMode === "inline") {
        next.k8s_kubectl_path = options?.kubectl_path;
        next.k8s_kubeconfig_path = options?.kubeconfig_path;
      } else {
        delete next.k8s_kubectl_path;
        delete next.k8s_kubeconfig_path;
      }
      return next;
    },
    [k8sMode],
  );

  const validateInlineK8sSelection = useCallback((): boolean => {
    if (!formData.k8s_enabled || k8sMode !== "inline") {
      setK8sSelectionError(null);
      return true;
    }

    let errorKey: string | null = null;
    if (!formData.k8s_context) {
      errorKey = "k8sConnections.errors.contextRequired";
    } else if (!formData.k8s_namespace) {
      errorKey = "k8sConnections.errors.namespaceRequired";
    } else if (
      formData.k8s_resource_type !== "service" &&
      formData.k8s_resource_type !== "pod"
    ) {
      errorKey = "k8sConnections.errors.resourceTypeInvalid";
    } else if (!formData.k8s_resource_name) {
      errorKey = "k8sConnections.errors.resourceNameRequired";
    } else if (
      effectiveK8sPort == null ||
      !Number.isInteger(effectiveK8sPort) ||
      effectiveK8sPort < 1 ||
      effectiveK8sPort > 65535
    ) {
      errorKey = "k8sConnections.errors.portInvalid";
    }

    if (errorKey) {
      setK8sSelectionError(t(errorKey));
      setActiveTab("k8s");
      return false;
    }

    setK8sSelectionError(null);
    return true;
  }, [
    effectiveK8sPort,
    formData.k8s_context,
    formData.k8s_enabled,
    formData.k8s_namespace,
    formData.k8s_resource_name,
    formData.k8s_resource_type,
    k8sMode,
    t,
  ]);

  const handleInlineContextChange = useCallback(
    (value: string) => {
      invalidateK8sAsync("new-k8s-namespaces");
      invalidateK8sAsync("new-k8s-resources");
      invalidateK8sAsync("new-k8s-ports");
      invalidateInlineK8sTest();
      setK8sSelectionError(null);
      setFormData((previous) => ({
        ...previous,
        k8s_context: value || undefined,
        k8s_namespace: undefined,
        k8s_resource_name: undefined,
      }));
      setK8sNamespaces([]);
      setK8sResources([]);
      setK8sAutoPort(null);
      setK8sDiscoveryError("namespaces", null);
      setK8sDiscoveryError("resources", null);
      setK8sPathActionError(null);
      if (value) {
        void loadK8sNamespacesList(value, appliedK8sOptions);
      }
    },
    [
      appliedK8sOptions,
      invalidateInlineK8sTest,
      invalidateK8sAsync,
      loadK8sNamespacesList,
      setK8sDiscoveryError,
    ],
  );

  const handleInlineNamespaceChange = useCallback(
    (value: string) => {
      invalidateK8sAsync("new-k8s-resources");
      invalidateK8sAsync("new-k8s-ports");
      invalidateInlineK8sTest();
      setK8sSelectionError(null);
      setFormData((previous) => ({
        ...previous,
        k8s_namespace: value || undefined,
        k8s_resource_name: undefined,
      }));
      setK8sResources([]);
      setK8sAutoPort(null);
      setK8sDiscoveryError("resources", null);
      if (formData.k8s_context && value && formData.k8s_resource_type) {
        void loadK8sResourcesList(
          formData.k8s_context,
          value,
          formData.k8s_resource_type,
          appliedK8sOptions,
        );
      }
    },
    [
      appliedK8sOptions,
      formData.k8s_context,
      formData.k8s_resource_type,
      invalidateInlineK8sTest,
      invalidateK8sAsync,
      loadK8sResourcesList,
      setK8sDiscoveryError,
    ],
  );

  const handleInlineResourceTypeChange = useCallback(
    (value: string) => {
      invalidateK8sAsync("new-k8s-resources");
      invalidateK8sAsync("new-k8s-ports");
      invalidateInlineK8sTest();
      setK8sSelectionError(null);
      setFormData((previous) => ({
        ...previous,
        k8s_resource_type: value || undefined,
        k8s_resource_name: undefined,
      }));
      setK8sResources([]);
      setK8sAutoPort(null);
      setK8sDiscoveryError("resources", null);
      if (formData.k8s_context && formData.k8s_namespace && value) {
        void loadK8sResourcesList(
          formData.k8s_context,
          formData.k8s_namespace,
          value,
          appliedK8sOptions,
        );
      }
    },
    [
      appliedK8sOptions,
      formData.k8s_context,
      formData.k8s_namespace,
      invalidateInlineK8sTest,
      invalidateK8sAsync,
      loadK8sResourcesList,
      setK8sDiscoveryError,
    ],
  );

  const handleInlineResourceNameChange = useCallback(
    (value: string) => {
      invalidateK8sAsync("new-k8s-ports");
      invalidateInlineK8sTest();
      setK8sSelectionError(null);
      setFormData((previous) => ({
        ...previous,
        k8s_resource_name: value || undefined,
      }));
      setK8sAutoPort(null);
      if (
        formData.k8s_context &&
        formData.k8s_namespace &&
        formData.k8s_resource_type === "service" &&
        value &&
        formData.k8s_port == null
      ) {
        void loadK8sResourcePorts(
          formData.k8s_context,
          formData.k8s_namespace,
          formData.k8s_resource_type,
          value,
          appliedK8sOptions,
        );
      }
    },
    [
      appliedK8sOptions,
      formData.k8s_context,
      formData.k8s_namespace,
      formData.k8s_port,
      formData.k8s_resource_type,
      invalidateInlineK8sTest,
      invalidateK8sAsync,
      loadK8sResourcePorts,
    ],
  );

  const handleInlinePortChange = useCallback(
    (value: string) => {
      invalidateK8sAsync("new-k8s-ports");
      invalidateInlineK8sTest();
      setK8sSelectionError(null);
      const isManual = value !== "";
      setFormData((previous) => ({
        ...previous,
        k8s_port: isManual ? Number(value) : undefined,
      }));
      setK8sAutoPort(null);
      if (
        !isManual &&
        formData.k8s_context &&
        formData.k8s_namespace &&
        formData.k8s_resource_type === "service" &&
        formData.k8s_resource_name
      ) {
        void loadK8sResourcePorts(
          formData.k8s_context,
          formData.k8s_namespace,
          formData.k8s_resource_type,
          formData.k8s_resource_name,
          appliedK8sOptions,
        );
      }
    },
    [
      appliedK8sOptions,
      formData.k8s_context,
      formData.k8s_namespace,
      formData.k8s_resource_name,
      formData.k8s_resource_type,
      invalidateInlineK8sTest,
      invalidateK8sAsync,
      loadK8sResourcePorts,
    ],
  );

  const handleK8sModeChange = useCallback(
    (mode: "existing" | "inline") => {
      invalidateK8sDiscovery();
      invalidateInlineK8sTest();
      setK8sMode(mode);
      setK8sContexts([]);
      setK8sNamespaces([]);
      setK8sResources([]);
      setK8sAutoPort(null);
      setK8sDiscoveryErrors({ contexts: null, namespaces: null, resources: null });
      setK8sPathActionError(null);
      setK8sSelectionError(null);

      if (mode === "existing") {
        resetK8sPathOverrides();
        setFormData((previous) => ({
          ...previous,
          k8s_context: undefined,
          k8s_namespace: undefined,
          k8s_resource_type: undefined,
          k8s_resource_name: undefined,
          k8s_port: undefined,
          k8s_kubectl_path: undefined,
          k8s_kubeconfig_path: undefined,
        }));
        return;
      }

      const options: K8sCommandOptions = {
        kubectl_path: formData.k8s_kubectl_path,
        kubeconfig_path: formData.k8s_kubeconfig_path,
      };
      initializeK8sPathOverrides(options);
      setFormData((previous) => ({
        ...previous,
        k8s_connection_id: undefined,
      }));
      if (isOpen && formData.k8s_enabled) {
        void loadK8sContextsList(options);
      }
    },
    [
      formData.k8s_enabled,
      formData.k8s_kubeconfig_path,
      formData.k8s_kubectl_path,
      initializeK8sPathOverrides,
      invalidateInlineK8sTest,
      invalidateK8sDiscovery,
      isOpen,
      loadK8sContextsList,
      resetK8sPathOverrides,
    ],
  );

  const handleK8sEnabledChange = useCallback(
    (enabled: boolean) => {
      setK8sSelectionError(null);
      setFormData((previous) => ({
        ...previous,
        k8s_enabled: enabled,
        ssh_enabled: enabled ? false : previous.ssh_enabled,
      }));
      if (!enabled) {
        invalidateK8sDiscovery();
        invalidateInlineK8sTest();
        return;
      }
      if (isOpen && k8sMode === "inline") {
        void loadK8sContextsList(appliedK8sOptions);
      }
    },
    [
      appliedK8sOptions,
      invalidateInlineK8sTest,
      invalidateK8sDiscovery,
      isOpen,
      k8sMode,
      loadK8sContextsList,
    ],
  );

  const handleSavedK8sConnectionChange = useCallback(
    (value: string) => {
      invalidateInlineK8sTest();
      setFormData((previous) => ({
        ...previous,
        k8s_connection_id: value || undefined,
      }));
    },
    [invalidateInlineK8sTest],
  );

  const updateField = (
    field: keyof ConnectionParams,
    value: string | number | boolean | undefined,
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const loadDatabases = async (
    overrides?: Partial<ConnectionParams>,
    shouldApply: () => boolean = () => true,
  ) => {
    const effectiveDriver = overrides?.driver ?? driver;
    const targetDriver = drivers.find((d) => d.id === effectiveDriver);

    if (
      targetDriver?.capabilities?.file_based === true ||
      targetDriver?.capabilities?.folder_based === true
    ) {
      return;
    }

    setLoadingDatabases(true);
    setDatabaseLoadError(null);
    try {
      const listParamsBase: Partial<ConnectionParams> = {
        ...formData,
        ...overrides,
        driver: effectiveDriver,
        port:
          overrides?.port != null
            ? Number(overrides.port)
            : formData.port != null
              ? Number(formData.port)
              : undefined,
      };
      const listParams: Partial<ConnectionParams> = {
        ...listParamsBase,
        k8s_port: resolveK8sPort(listParamsBase),
      };
      const databases = await invoke<string[]>("list_databases", {
        request: {
          params: { ...listParams },
          connection_id: initialConnection?.id,
        },
      });
      if (!shouldApply()) return;
      setAvailableDatabases(databases);
      if (initialConnection) {
        // Pre-select databases already associated with the connection
        const existing = Array.isArray(initialConnection.params.database)
          ? initialConnection.params.database
          : initialConnection.params.database
            ? [initialConnection.params.database as string]
            : [];
        setSelectedDatabasesState((prev) => {
          const merged = Array.from(new Set([...existing, ...prev]));
          return merged.filter((db) => databases.includes(db));
        });
      }
    } catch (err) {
      if (!shouldApply()) return;
      const errorMsg =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : t("newConnection.failLoadDatabases");
      setDatabaseLoadError(errorMsg);
      setAvailableDatabases([]);
    } finally {
      if (shouldApply()) setLoadingDatabases(false);
    }
  };

  // ── init form on open ──
  useEffect(() => {
    if (!isOpen) {
      initSequenceRef.current += 1;
      return;
    }
    const initSequence = ++initSequenceRef.current;
    const isCurrentInit = () => initSequenceRef.current === initSequence;
    queueMicrotask(() => {
      if (isCurrentInit()) setLoadingDatabases(false);
    });
    const init = async () => {
      // Reset common state first so it's always clean even if async calls below fail
      setStatus("idle");
      setMessage("");
      setTestResult(null);
      setActiveTab("general");
      setAvailableDatabases([]);
      setDatabaseLoadError(null);
      setPasswordDirty(false);
      setSshPasswordDirty(false);
      setDbSearchQuery("");
      setConnectionString("");
      setConnectionStringError(null);
      setNameError(false);
      setDatabasesTabError(false);
      setPendingGroup(null);
      setInstallStatus("idle");
      setInstallError(undefined);
      setStep(initialConnection ? "form" : "catalogue");
      invalidateK8sDiscovery();
      invalidateK8sAsync("new-k8s-test");
      inlineK8sTestSequenceRef.current += 1;
      inlineK8sTestActiveRef.current = false;
      setK8sAutoPort(null);
      setK8sContexts([]);
      setK8sNamespaces([]);
      setK8sResources([]);
      setK8sDiscoveryErrors({ contexts: null, namespaces: null, resources: null });
      setK8sPathActionError(null);
      setK8sSelectionError(null);

      if (initialConnection) {
        setName(initialConnection.name);
        setDriver(initialConnection.params.driver);
        setDetectJsonInTextColumns(
          initialConnection.detect_json_in_text_columns === true,
        );
        setAppearance(initialConnection.appearance ?? {});
        const db = initialConnection.params.database;
        setSshMode(
          initialConnection.params.ssh_connection_id ? "existing" : "inline",
        );
        let params = initialConnection.params;
        try {
          const fullConn = await fetchConnectionWithCredentials(
            initialConnection.id,
          );
          // A response without params would blank the form, so keep the
          // secret-less ones instead of overwriting them with nothing.
          if (fullConn?.params) params = fullConn.params;
        } catch {
          // fallback: use params without secrets (backend will retrieve from keychain)
        }
        if (!isCurrentInit()) return;

        const isInlineK8s = !params.k8s_connection_id;
        const pathOptions: K8sCommandOptions = isInlineK8s
          ? {
              kubectl_path: params.k8s_kubectl_path,
              kubeconfig_path: params.k8s_kubeconfig_path,
            }
          : {};
        const hasK8sPortOverride = params.k8s_port != null;
        const paramsForForm = isInlineK8s
          ? params
          : {
              ...params,
              k8s_kubectl_path: undefined,
              k8s_kubeconfig_path: undefined,
            };
        setK8sMode(isInlineK8s ? "inline" : "existing");
        initializeK8sPathOverrides(pathOptions);
        if (Array.isArray(db)) {
          setSelectedDatabasesState(db);
          setFormData({ ...paramsForForm, database: db[0] ?? "" });
        } else {
          setSelectedDatabasesState([]);
          setFormData({ ...paramsForForm });
        }

        if (params.k8s_enabled && isInlineK8s) {
          void loadK8sContextsList(pathOptions);
          if (params.k8s_context) {
            void loadK8sNamespacesList(params.k8s_context, pathOptions);
          }
          if (
            params.k8s_context &&
            params.k8s_namespace &&
            params.k8s_resource_type
          ) {
            void loadK8sResourcesList(
              params.k8s_context,
              params.k8s_namespace,
              params.k8s_resource_type,
              pathOptions,
            );
          }
          if (
            !hasK8sPortOverride &&
            params.k8s_context &&
            params.k8s_namespace &&
            params.k8s_resource_type === "service" &&
            params.k8s_resource_name
          ) {
            void loadK8sResourcePorts(
              params.k8s_context,
              params.k8s_namespace,
              params.k8s_resource_type,
              params.k8s_resource_name,
              pathOptions,
            );
          }
        }

        // Auto-load available databases when editing a multi-db connection
        const editDriver = drivers.find(
          (d) => d.id === initialConnection.params.driver,
        );
        if (isMultiDatabaseCapable(editDriver?.capabilities)) {
          void loadDatabases(params, isCurrentInit);
        }
      } else {
        setName("");
        setDriver("mysql");
        setFormData({
          host: "localhost",
          port: 3306,
          username: "",
          database: "",
          ssh_enabled: false,
          ssh_port: 22,
          k8s_enabled: false,
        });
        setSelectedDatabasesState([]);
        setSshMode("existing");
        setK8sMode("existing");
        resetK8sPathOverrides();
        setDetectJsonInTextColumns(false);
        setAppearance({});
      }

      const nextSshConnections = await loadSshConnections();
      if (!isCurrentInit()) return;
      setSshConnections(nextSshConnections);

      const nextK8sConnections = await loadK8sConnections();
      if (!isCurrentInit()) return;
      setK8sConnections(nextK8sConnections);
    };
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialConnection]);

  const handleDriverChange = (newDriver: string) => {
    setDriver(newDriver);
    setFormData({
      driver: newDriver,
      host: "",
      port: drivers.find((d) => d.id === newDriver)?.default_port ?? undefined,
      username: "",
      password: "",
      database: "",
      ssl_mode: "",
      ssh_enabled: false,
      ssh_connection_id: undefined,
      ssh_host: undefined,
      ssh_port: 22,
      ssh_user: undefined,
      ssh_password: undefined,
      ssh_key_file: undefined,
      ssh_key_passphrase: undefined,
      save_in_keychain: false,
      k8s_enabled: false,
      k8s_connection_id: undefined,
      k8s_context: undefined,
      k8s_namespace: undefined,
      k8s_resource_type: undefined,
      k8s_resource_name: undefined,
      k8s_port: undefined,
      k8s_kubectl_path: undefined,
      k8s_kubeconfig_path: undefined,
    });
    invalidateK8sDiscovery();
    invalidateInlineK8sTest();
    resetK8sPathOverrides();
    setK8sAutoPort(null);
    setK8sContexts([]);
    setK8sNamespaces([]);
    setK8sResources([]);
    setK8sDiscoveryErrors({ contexts: null, namespaces: null, resources: null });
    setK8sPathActionError(null);
    setK8sSelectionError(null);
    setSelectedDatabasesState([]);
    setDbSearchQuery("");
    setAvailableDatabases([]);
    setDatabaseLoadError(null);
    setStatus("idle");
    setMessage("");
    setActiveTab("general");
    setConnectionString("");
    setConnectionStringError(null);
    setNameError(false);
    setDatabasesTabError(false);
    setInstallStatus("idle");
    setInstallError(undefined);
  };

  const goToForm = (d: CatalogueDriver) => {
    handleDriverChange(d.slug);
    setPendingGroup(null);
    setStep("form");
    // Picking an already-installed external driver from the catalogue is an
    // explicit intent to use it — activate it so the form resolves it instead of
    // falling back to a built-in. (Not-installed drivers route through the
    // InstallGate, which activates on install.)
    if (!d.isBuiltin && d.installed) {
      void updateSetting(
        "activeExternalDrivers",
        Array.from(new Set([...(settings.activeExternalDrivers ?? []), d.slug])),
      );
    }
  };

  const handleEngineSelect = (group: EngineGroup) => {
    const sel = resolveEngineSelection(group);
    if (sel.mode === "pick-driver") {
      setPendingGroup(group);
    } else if (sel.driver) {
      // not-installed drivers are routed to the InstallGate by the form-step render; proceed either way
      goToForm(sel.driver);
    }
  };

  const testConnection = async () => {
    if (step === "catalogue") return false;
    if (installStatus === "installing") return false;
    if (activeDriverNotInstalled && activeCatalogueDriver) {
      const ok = await installDriver(
        activeCatalogueDriver.slug,
        activeCatalogueDriver.latestVersion,
      );
      if (!ok) return false; // banner shows the error; do not proceed
    }

    const preflight = await preflightFormAction();
    if (!preflight) return false;
    const { actionId, startingSnapshot, inlinePaths } = preflight;

    try {
      if (!validateInlineK8sSelection()) return false;

      const usesK8s = formData.k8s_enabled === true;
      const k8sTestSequence = usesK8s
        ? ++inlineK8sTestSequenceRef.current
        : undefined;
      inlineK8sTestActiveRef.current = usesK8s;

      setStatus("testing");
      setMessage("");
      setTestResult(null);
      try {
        const testParamsBase: Partial<ConnectionParams> = {
          driver,
          ...formData,
          port: formData.port != null ? Number(formData.port) : undefined,
          k8s_port: effectiveK8sPort,
          database: isMultiDb
            ? (selectedDatabasesState[0] ??
              (typeof formData.database === "string" ? formData.database : ""))
            : formData.database,
        };
        const testParams = withInlineK8sPaths(
          testParamsBase,
          inlinePaths.options,
        );
        const invokeTest = () =>
          invoke<string>("test_connection", {
            request: {
              params: { ...testParams },
              connection_id: initialConnection?.id,
            },
          });

        let result: string;
        if (usesK8s) {
          const latestResult = await runK8sAsync("new-k8s-test", invokeTest);
          if (latestResult.status === "stale") return false;
          if (latestResult.status === "error") throw latestResult.error;
          result = latestResult.value;
        } else {
          result = await invokeTest();
        }

        if (
          activeActionRef.current !== actionId ||
          actionSnapshotRef.current !== startingSnapshot
        ) {
          if (activeActionRef.current === actionId) {
            inlineK8sTestActiveRef.current = false;
            setStatus("idle");
            setMessage("");
            setTestResult(null);
          }
          return false;
        }
        setStatus("success");
        setMessage(result);
        setTestResult("success");
        setTimeout(() => {
          if (
            k8sTestSequence !== undefined &&
            inlineK8sTestSequenceRef.current !== k8sTestSequence
          ) {
            return;
          }
          inlineK8sTestActiveRef.current = false;
          setTestResult(null);
          setStatus("idle");
          setMessage("");
        }, 3000);
        return true;
      } catch (err) {
        if (
          activeActionRef.current !== actionId ||
          actionSnapshotRef.current !== startingSnapshot
        ) {
          if (activeActionRef.current === actionId) {
            inlineK8sTestActiveRef.current = false;
            setStatus("idle");
            setMessage("");
            setTestResult(null);
          }
          return false;
        }
        setStatus("error");
        const msg =
          typeof err === "string"
            ? err
            : err instanceof Error
              ? err.message
              : JSON.stringify(err);
        setMessage(msg);
        setTestResult("error");
        setTimeout(() => {
          if (
            k8sTestSequence !== undefined &&
            inlineK8sTestSequenceRef.current !== k8sTestSequence
          ) {
            return;
          }
          inlineK8sTestActiveRef.current = false;
          setTestResult(null);
          setStatus("idle");
        }, 3000);
        return false;
      }
    } finally {
      finishFormAction(actionId);
    }
  };

  const saveConnection = async () => {
    if (step === "catalogue") return;
    if (installStatus === "installing") return;
    if (activeDriverNotInstalled && activeCatalogueDriver) {
      const ok = await installDriver(
        activeCatalogueDriver.slug,
        activeCatalogueDriver.latestVersion,
      );
      if (!ok) return; // banner shows the error; do not proceed
    }

    const preflight = await preflightFormAction();
    if (!preflight) return;
    const { actionId, startingSnapshot, inlinePaths } = preflight;

    try {
      invalidateK8sAsync("new-k8s-test");
      inlineK8sTestSequenceRef.current += 1;
      inlineK8sTestActiveRef.current = false;

      if (!name.trim()) {
        setStatus("error");
        setMessage(t("newConnection.nameRequired"));
        setTestResult("error");
        setNameError(true);
        nameInputRef.current?.focus();
        return;
      }
      if (isMultiDb) {
        if (selectedDatabasesState.length === 0) {
          setStatus("error");
          setMessage(t("newConnection.noDatabasesSelected"));
          setTestResult("error");
          setActiveTab("databases");
          setDatabasesTabError(true);
          return;
        }
      } else if (
        !noConnectionRequired &&
        !singleDatabase &&
        (!formData.database ||
          (typeof formData.database === "string" && !formData.database.trim()))
      ) {
        setStatus("error");
        setMessage(t("newConnection.dbNameRequired"));
        setTestResult("error");
        return;
      }
      if (!validateInlineK8sSelection()) return;

      const paramsBase: Partial<ConnectionParams> = {
        driver,
        ...formData,
        port: formData.port != null ? Number(formData.port) : undefined,
        k8s_port: effectiveK8sPort,
        database: isMultiDb
          ? selectedDatabasesState.length === 1
            ? selectedDatabasesState[0]
            : selectedDatabasesState
          : singleDatabase
            ? typeof formData.database === "string" && formData.database.trim()
              ? formData.database
              : driver
            : formData.database,
      };
      const params = withInlineK8sPaths(paramsBase, inlinePaths.options);
      const appearancePayload =
        appearance.icon || appearance.accentColor ? appearance : undefined;
      const finalImagePath =
        appearance.icon?.type === "image" ? appearance.icon.path : null;
      const uploadedPathsForAction = [...uploadedPathsRef.current];
      const originalImagePathForAction = originalImagePath.current;

      if (
        activeActionRef.current !== actionId ||
        actionSnapshotRef.current !== startingSnapshot
      ) {
        return;
      }
      persistenceActionRef.current = actionId;
      setIsPersistencePending(true);
      setStatus("saving");
      setMessage("");
      setTestResult(null);
      try {
        if (initialConnection) {
          if (!params.password?.trim()) delete params.password;
          if (!params.ssh_password?.trim()) delete params.ssh_password;
          await invoke("update_connection", {
            id: initialConnection.id,
            name,
            params,
            detectJsonInTextColumns: detectJsonInTextColumns ? true : null,
          });
          await invoke("set_connection_appearance", {
            id: initialConnection.id,
            appearance: appearancePayload ?? null,
          });
        } else {
          const saved = await invoke<{ id: string }>("save_connection", {
            name,
            params,
            detectJsonInTextColumns: detectJsonInTextColumns ? true : null,
          });
          if (appearancePayload) {
            await invoke("set_connection_appearance", {
              id: saved.id,
              appearance: appearancePayload,
            });
          }
        }

        if (
          activeActionRef.current !== actionId ||
          actionSnapshotRef.current !== startingSnapshot
        ) {
          if (activeActionRef.current === actionId) {
            setStatus("idle");
            setMessage("");
            setTestResult(null);
          }
          return;
        }

        if (onSave) onSave();
        wasSavedRef.current = true;

        // Delete only paths owned by this save attempt. Paths uploaded by a
        // superseding session remain tracked for that session's own cleanup.
        const toDelete = uploadedPathsForAction.filter(
          (path) => path !== finalImagePath,
        );
        if (
          originalImagePathForAction &&
          originalImagePathForAction !== finalImagePath &&
          !toDelete.includes(originalImagePathForAction)
        ) {
          toDelete.push(originalImagePathForAction);
        }
        await Promise.all(
          toDelete.map((path) =>
            invoke("delete_connection_icon", { relativePath: path }).catch(
              () => {},
            ),
          ),
        );
        const handledUploads = new Set(uploadedPathsForAction);
        uploadedPathsRef.current = uploadedPathsRef.current.filter(
          (path) => !handledUploads.has(path),
        );

        persistenceActionRef.current = null;
        setIsPersistencePending(false);
        handleClose();
      } catch (err) {
        if (
          activeActionRef.current === actionId &&
          actionSnapshotRef.current === startingSnapshot
        ) {
          setStatus("error");
          setMessage(
            typeof err === "string" ? err : t("newConnection.failSave"),
          );
          setTestResult("error");
        } else if (activeActionRef.current === actionId) {
          setStatus("idle");
          setMessage("");
          setTestResult(null);
        }
      }
    } finally {
      if (persistenceActionRef.current === actionId) {
        persistenceActionRef.current = null;
        setIsPersistencePending(false);
      }
      finishFormAction(actionId);
    }
  };

  // ── connection string import ──
  const handleConnectionStringChange = (value: string) => {
    setConnectionString(value);
    setConnectionStringError(null);

    if (!value.trim()) {
      return;
    }

    const parserDrivers = drivers.map((item) => ({
      id: item.id,
      capabilities: item.capabilities,
    }));

    const result = parseConnectionString(value, parserDrivers);
    if (result.success) {
      const parsed = toConnectionParams(result.params);
      const newDriver = parsed.driver || driver;
      const parsedDriver = drivers.find((item) => item.id === newDriver);
      const parsedIsMultiDb = isMultiDatabaseCapable(
        parsedDriver?.capabilities,
      );

      const parsedFields: Partial<ConnectionParams> = {
        driver: newDriver,
        host: parsed.host || "localhost",
        port: parsed.port,
        username: parsed.username || "",
        password: parsed.password || "",
        database: parsed.database || "",
      };

      if (parsedIsMultiDb && parsed.database) {
        setSelectedDatabasesState([parsed.database]);
      }

      if (newDriver !== driver) {
        setDriver(newDriver);
      }

      setFormData((prev) => ({
        ...prev,
        ...parsedFields,
      }));

      void loadDatabases(parsedFields);
    } else {
      setConnectionStringError(result.error);
    }
  };

  const handleClearConnectionString = () => {
    setConnectionString("");
    setConnectionStringError(null);
  };

  // ── rendered general tab content ──
  const generalTabContent = (
    <div className="space-y-4">
      {/* API-based: no connection form needed — plugin may provide custom content via slot */}
      {noConnectionRequired ? (
        hasConnectionContentSlot ? (
          <SlotAnchor
            name="connection-modal.connection_content"
            context={dbFieldSlotContext}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-strong bg-base/40 px-6 py-10 text-center">
            <span
              className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl shadow-sm"
              style={{ backgroundColor: `${driverAccent}1f`, color: driverAccent }}
            >
              {renderDriverGlyph(24)}
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium text-primary">
                {t("newConnection.noConnectionDetailsTitle", {
                  defaultValue: "No connection details needed",
                })}
              </p>
              <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted">
                {t("newConnection.noConnectionDetailsBody", {
                  driver: activeDriver?.name ?? driver,
                  defaultValue:
                    "{{driver}} connects without a host or port. Just give this connection a name and save it. Driver-specific options live in Settings → Plugins.",
                })}
              </p>
            </div>
          </div>
        )
      ) : activeDriver?.capabilities?.file_based === true ||
        activeDriver?.capabilities?.folder_based === true ? (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
            {activeDriver.capabilities.folder_based
              ? t("newConnection.folderPath")
              : t("newConnection.filePath")}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={
                typeof formData.database === "string" ? formData.database : ""
              }
              onChange={(e) => updateField("database", e.target.value)}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted placeholder:italic focus:border-blue-500 focus:outline-none transition-colors"
              placeholder={
                activeDriver.capabilities.folder_based
                  ? t("newConnection.folderPathPlaceholder")
                  : t("newConnection.filePathPlaceholder")
              }
            />
            <button
              type="button"
              onClick={async () => {
                const selected = await open({
                  multiple: false,
                  directory: activeDriver.capabilities.folder_based,
                });
                if (selected) updateField("database", selected);
              }}
              className="px-3 py-2 bg-base hover:bg-surface-secondary border border-strong rounded-md text-muted hover:text-primary transition-colors"
              title={
                activeDriver.capabilities.folder_based
                  ? t("newConnection.browseFolder")
                  : t("newConnection.browseFile")
              }
            >
              <FolderOpen size={15} />
            </button>
          </div>
        </div>
      ) : (
        <>
          {connectionStringEnabled && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
                  {t("newConnection.connectionString", {
                    defaultValue: "Connection String",
                  })}
                </label>
                {connectionString && (
                  <button
                    type="button"
                    onClick={handleClearConnectionString}
                    className="text-xs text-muted hover:text-primary transition-colors"
                  >
                    {t("common.clear", { defaultValue: "Clear" })}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={connectionString}
                  onChange={(e) => handleConnectionStringChange(e.target.value)}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  className={clsx(
                    "flex-1 px-3 py-2 bg-base border rounded-md text-sm text-primary placeholder:text-muted placeholder:italic focus:border-blue-500 focus:outline-none transition-colors",
                    connectionStringError ? "border-red-500" : "border-strong",
                  )}
                  placeholder={connectionStringPlaceholder}
                />
                {connectionString && !connectionStringError && (
                  <div className="px-3 py-2 bg-green-900/20 border border-green-500/30 rounded-md text-green-400 flex items-center">
                    <Check size={15} />
                  </div>
                )}
              </div>
              {connectionStringError && (
                <div className="flex items-center gap-1 text-xs text-red-400 mt-0.5">
                  <AlertCircle size={11} /> {connectionStringError}
                </div>
              )}
            </div>
          )}

          {/* Host + Port */}
          <div
            className={clsx(
              "grid gap-3",
              driver === "postgres" ? "grid-cols-4" : "grid-cols-3",
            )}
          >
            <FieldInput
              className="col-span-2"
              label={t("newConnection.host")}
              value={formData.host}
              onChange={(v) => updateField("host", v)}
              placeholder="localhost"
            />
            <FieldInput
              label={t("newConnection.port")}
              value={formData.port}
              onChange={(v) => updateField("port", v)}
              type="number"
              placeholder={driver === "mysql" ? "3306" : "5432"}
            />
          </div>

          {/* User + Password */}
          <div className="grid grid-cols-2 gap-3">
            <FieldInput
              label={t("newConnection.username")}
              value={formData.username}
              onChange={(v) => updateField("username", v)}
              placeholder={t("newConnection.usernamePlaceholder")}
            />
            <FieldInput
              label={t("newConnection.password")}
              value={formData.password}
              onChange={(v) => {
                setPasswordDirty(true);
                updateField("password", v);
              }}
              type="password"
              placeholder={
                initialConnection && !passwordDirty && !formData.password
                  ? "••••••••"
                  : t("newConnection.passwordPlaceholder")
              }
            />
          </div>

          {/* Database (single) — only shown for non-multi-db drivers */}
          {!isMultiDb && !singleDatabase && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
                  {t("newConnection.dbName")}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    void loadDatabases();
                  }}
                  disabled={
                    loadingDatabases || !formData.host || !formData.username
                  }
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:text-muted disabled:cursor-not-allowed transition-colors"
                >
                  {loadingDatabases ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Database size={11} />
                  )}
                  {loadingDatabases
                    ? t("newConnection.loadingDatabases")
                    : t("newConnection.loadDatabases")}
                </button>
              </div>
              {availableDatabases.length > 0 ? (
                <Select
                  value={
                    typeof formData.database === "string"
                      ? formData.database || null
                      : null
                  }
                  options={availableDatabases}
                  onChange={(val) => updateField("database", val)}
                  placeholder={t("newConnection.selectDatabase")}
                  searchPlaceholder={t("common.search")}
                  noResultsLabel={t("newConnection.noDatabasesFound")}
                />
              ) : (
                <input
                  type="text"
                  value={
                    typeof formData.database === "string"
                      ? formData.database
                      : ""
                  }
                  onChange={(e) => updateField("database", e.target.value)}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted placeholder:italic focus:border-blue-500 focus:outline-none transition-colors"
                  placeholder={t("newConnection.dbNamePlaceholder")}
                />
              )}
              {databaseLoadError && (
                <div className="flex items-center gap-1 text-xs text-red-400 mt-0.5">
                  <AlertCircle size={11} /> {databaseLoadError}
                </div>
              )}
            </div>
          )}

          {/* Keychain */}
          <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              checked={!!formData.save_in_keychain}
              onChange={(e) => {
                updateField("save_in_keychain", e.target.checked);
              }}
              className="accent-blue-500 w-3.5 h-3.5 rounded"
            />
            <span className="text-xs text-secondary">
              {t("newConnection.saveKeychain")}
            </span>
          </label>
        </>
      )}

      {/* Detect JSON in text columns (per-connection opt-in) */}
      <label className="flex items-start gap-2 cursor-pointer select-none w-fit">
        <input
          type="checkbox"
          checked={detectJsonInTextColumns}
          onChange={(e) => setDetectJsonInTextColumns(e.target.checked)}
          className="accent-blue-500 w-3.5 h-3.5 rounded mt-0.5"
        />
        <span className="text-xs text-secondary leading-snug">
          <span className="block">{t("settings.detectJsonInTextColumns")}</span>
          <span className="block text-muted">
            {t("settings.detectJsonInTextColumnsDesc")}
          </span>
        </span>
      </label>

    </div>
  );

  // ── rendered Appearance tab content (per-connection icon + accent color) ──
  const appearanceTabContent = (
    <AppearanceSection
      value={appearance}
      onChange={setAppearance}
      connectionId={effectiveConnectionId}
      driverManifest={activeDriver}
      connectionName={name || t("newConnection.unnamedConnection", { defaultValue: "Unnamed connection" })}
      onImageUploaded={handleImageUploaded}
    />
  );

  // ── rendered Advanced tab content (driver-specific options + startup SQL) ──
  const advancedTabContent = (
    <div className="space-y-4">
      {/* MySQL: PIPES_AS_CONCAT compatibility (Vitess/PlanetScale) */}
      {driver === "mysql" && (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              id="pipes-as-concat-toggle"
              checked={formData.pipes_as_concat !== false}
              onChange={(e) =>
                updateField(
                  "pipes_as_concat",
                  e.target.checked ? undefined : false,
                )
              }
              className="accent-blue-500 w-3.5 h-3.5 rounded"
            />
            <span className="text-sm font-medium text-secondary">
              {t("newConnection.pipesAsConcat", {
                defaultValue: "Set PIPES_AS_CONCAT sql_mode on connect",
              })}
            </span>
          </label>
          <p className="text-xs text-muted">
            {t("newConnection.pipesAsConcatHint", {
              defaultValue:
                "Leave enabled — Tabularis automatically skips it on servers that reject it (Vitess/PlanetScale).",
            })}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-[10px] uppercase font-semibold tracking-wider text-muted block">
          {t("newConnection.startupScript", { defaultValue: "Startup Script" })}
        </label>
      <p className="text-xs text-muted leading-snug">
        {t("newConnection.startupScriptDescription", {
          defaultValue:
            "SQL run on every new connection to this data source. Use it for session settings such as SET / set_config (e.g. bypassing RLS). Separate statements with semicolons.",
        })}
      </p>
      <div className="border border-strong rounded-md overflow-hidden h-48">
        <SqlEditorWrapper
          editorKey={`startup-script-${initialConnection?.id ?? "new"}`}
          initialValue={formData.startup_script ?? ""}
          onChange={(value) => updateField("startup_script", value)}
          onRun={() => {}}
          height="100%"
          options={{
            placeholder: t("newConnection.startupScriptPlaceholder", {
              defaultValue: "SELECT set_config('app.bypass_rls', 'on', false);",
            }),
          }}
        />
        </div>
      </div>
    </div>
  );

  // ── rendered Databases tab content (multi-db selection) ──
  const databasesTabContent = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          {t("newConnection.selectDatabasesHint", {
            defaultValue: "Select the databases to include in this connection.",
          })}
        </p>
        <button
          type="button"
          onClick={() => {
            void loadDatabases();
          }}
          disabled={loadingDatabases || !formData.host || !formData.username}
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:text-muted disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {loadingDatabases ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Database size={11} />
          )}
          {loadingDatabases
            ? t("newConnection.loadingDatabases")
            : t("newConnection.loadDatabases")}
        </button>
      </div>
      {databaseLoadError && (
        <div className="flex items-center gap-1 text-xs text-red-400">
          <AlertCircle size={11} /> {databaseLoadError}
        </div>
      )}
      {availableDatabases.length > 0 ? (
        <div className="border border-strong rounded-md overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-default bg-base">
            <input
              type="text"
              value={dbSearchQuery}
              onChange={(e) => setDbSearchQuery(e.target.value)}
              placeholder={t("common.search")}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent text-xs text-primary placeholder:text-muted outline-none"
            />
            <button
              type="button"
              onClick={() => {
                const filteredDbs = availableDatabases.filter((db) =>
                  db.toLowerCase().includes(dbSearchQuery.toLowerCase()),
                );
                const allSel = filteredDbs.every((db) =>
                  selectedDatabasesState.includes(db),
                );
                if (allSel) {
                  setSelectedDatabasesState((prev) =>
                    prev.filter((db) => !filteredDbs.includes(db)),
                  );
                } else {
                  setSelectedDatabasesState((prev) =>
                    Array.from(new Set([...prev, ...filteredDbs])),
                  );
                  if (databasesTabError) setDatabasesTabError(false);
                }
              }}
              className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap shrink-0"
            >
              {availableDatabases
                .filter((db) =>
                  db.toLowerCase().includes(dbSearchQuery.toLowerCase()),
                )
                .every((db) => selectedDatabasesState.includes(db))
                ? t("sidebar.deselectAll")
                : t("sidebar.selectAll")}
            </button>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {availableDatabases
              .filter((db) =>
                db.toLowerCase().includes(dbSearchQuery.toLowerCase()),
              )
              .map((db) => {
                const sel = selectedDatabasesState.includes(db);
                return (
                  <div
                    key={db}
                    onClick={() => {
                      setSelectedDatabasesState((prev) =>
                        sel ? prev.filter((d) => d !== db) : [...prev, db],
                      );
                      if (databasesTabError && !sel)
                        setDatabasesTabError(false);
                    }}
                    className={clsx(
                      "flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-sm transition-colors hover:bg-surface-secondary select-none",
                      sel ? "text-primary" : "text-muted",
                    )}
                  >
                    <span
                      className={clsx(
                        "shrink-0",
                        sel ? "text-blue-500" : "text-muted",
                      )}
                    >
                      {sel ? <CheckSquare size={13} /> : <Square size={13} />}
                    </span>
                    <span className="truncate">{db}</span>
                  </div>
                );
              })}
          </div>
          <div className="px-2.5 py-1.5 border-t border-default bg-base text-xs text-muted">
            {selectedDatabasesState.length > 0
              ? t("newConnection.selectedDatabases", {
                  count: selectedDatabasesState.length,
                })
              : t("newConnection.noDatabasesSelected")}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted border border-dashed border-strong rounded-md">
          <Database size={20} className="opacity-40" />
          <p className="text-xs">
            {t("newConnection.loadDatabasesHint", {
              defaultValue:
                "Click Load Databases to fetch available databases.",
            })}
          </p>
        </div>
      )}
    </div>
  );

  // ── rendered SSL tab content ──
  const sslTabContent = (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        {t("newConnection.sslDescription", {
          defaultValue: "Configure SSL/TLS for secure database connections (optional).",
        })}
      </p>

      {/* SSL Mode */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
          {t("newConnection.sslMode", { defaultValue: "SSL Mode" })}
        </label>
        <Select
          value={
            formData.ssl_mode ||
            (driver === "postgres"
              ? "prefer"
              : driver === "clickhouse"
                ? "disable"
                : "required")
          }
          options={
            driver === "postgres"
              ? ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]
              : driver === "clickhouse"
                ? ["disable", "require"]
                : ["disabled", "preferred", "required", "verify_ca", "verify_identity"]
          }
          labels={
            driver === "postgres"
              ? {
                  disable: t("newConnection.sslModes.disable", { defaultValue: "Disable" }),
                  allow: t("newConnection.sslModes.allow", { defaultValue: "Allow" }),
                  prefer: t("newConnection.sslModes.prefer", { defaultValue: "Prefer" }),
                  require: t("newConnection.sslModes.require", { defaultValue: "Require" }),
                  "verify-ca": t("newConnection.sslModes.verify-ca", { defaultValue: "Verify CA" }),
                  "verify-full": t("newConnection.sslModes.verify-full", { defaultValue: "Verify Full" }),
                }
              : driver === "clickhouse"
                ? {
                    disable: t("newConnection.sslModes.disable", { defaultValue: "Disable" }),
                    require: t("newConnection.sslModes.require", { defaultValue: "Require" }),
                  }
                : {
                    disabled: t("newConnection.sslModes.disabled", { defaultValue: "Disabled" }),
                    preferred: t("newConnection.sslModes.preferred", { defaultValue: "Preferred" }),
                    required: t("newConnection.sslModes.required", { defaultValue: "Required" }),
                    verify_ca: t("newConnection.sslModes.verify_ca", { defaultValue: "Verify CA" }),
                    verify_identity: t("newConnection.sslModes.verify_identity", { defaultValue: "Verify Identity" }),
                  }
          }
          onChange={(v) => {
            updateField("ssl_mode", v);
            // Cleartext auth must never go over an unencrypted link.
            if (driver === "mysql" && v === "disabled") {
              updateField("enable_cleartext_plugin", false);
            }
          }}
          searchable={false}
        />
      </div>

      {/* SSL Certificate Files */}
      {formData.ssl_mode && formData.ssl_mode !== "disable" && formData.ssl_mode !== "disabled" && (
        <div className="space-y-3 pt-2">
          <p className="text-xs text-muted">
            {t("newConnection.sslCertificatesOptional", {
              defaultValue: "Certificate paths are optional. Leave empty to use system defaults.",
            })}
          </p>

          {/* CA Certificate */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
              {t("newConnection.sslCa", { defaultValue: "CA Certificate" })}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.ssl_ca || ""}
                onChange={(e) => updateField("ssl_ca", e.target.value)}
                placeholder="/path/to/ca-cert.pem"
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted placeholder:italic focus:border-blue-500 focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={async () => {
                  const selected = await open({
                    multiple: false,
                    directory: false,
                    filters: [
                      { name: "Certificate Files", extensions: ["pem", "crt", "cer", "der"] },
                      { name: "All Files", extensions: ["*"] },
                    ],
                  });
                  if (selected) updateField("ssl_ca", selected);
                }}
                className="px-3 py-2 bg-base hover:bg-surface-secondary border border-strong rounded-md text-muted hover:text-primary transition-colors"
                title={t("newConnection.browseFile", { defaultValue: "Browse" })}
              >
                <FolderOpen size={15} />
              </button>
            </div>
          </div>

          {/* Client Certificate */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
              {t("newConnection.sslCert", { defaultValue: "Client Certificate" })}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.ssl_cert || ""}
                onChange={(e) => updateField("ssl_cert", e.target.value)}
                placeholder="/path/to/client-cert.pem"
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted placeholder:italic focus:border-blue-500 focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={async () => {
                  const selected = await open({
                    multiple: false,
                    directory: false,
                    filters: [
                      { name: "Certificate Files", extensions: ["pem", "crt", "cer", "der"] },
                      { name: "All Files", extensions: ["*"] },
                    ],
                  });
                  if (selected) updateField("ssl_cert", selected);
                }}
                className="px-3 py-2 bg-base hover:bg-surface-secondary border border-strong rounded-md text-muted hover:text-primary transition-colors"
                title={t("newConnection.browseFile", { defaultValue: "Browse" })}
              >
                <FolderOpen size={15} />
              </button>
            </div>
          </div>

          {/* Client Key */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
              {t("newConnection.sslKey", { defaultValue: "Client Key" })}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.ssl_key || ""}
                onChange={(e) => updateField("ssl_key", e.target.value)}
                placeholder="/path/to/client-key.pem"
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted placeholder:italic focus:border-blue-500 focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={async () => {
                  const selected = await open({
                    multiple: false,
                    directory: false,
                    filters: [
                      { name: "Key Files", extensions: ["pem", "key"] },
                      { name: "All Files", extensions: ["*"] },
                    ],
                  });
                  if (selected) updateField("ssl_key", selected);
                }}
                className="px-3 py-2 bg-base hover:bg-surface-secondary border border-strong rounded-md text-muted hover:text-primary transition-colors"
                title={t("newConnection.browseFile", { defaultValue: "Browse" })}
              >
                <FolderOpen size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cleartext password plugin (MySQL/MariaDB only) */}
      {driver === "mysql" &&
        (() => {
          const effectiveSslMode = formData.ssl_mode || "required";
          // Cleartext credentials must travel over enforced TLS. `preferred`
          // only attempts TLS and can silently fall back to plaintext, so it is
          // gated off here to match the backend (build_mysql_options).
          const tlsOff = !["required", "verify_ca", "verify_identity"].includes(
            effectiveSslMode,
          );
          return (
            <div className="space-y-1.5 pt-2 border-t border-strong">
              <label
                className={clsx(
                  "flex items-center gap-2.5 select-none w-fit",
                  tlsOff ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                )}
              >
                <input
                  type="checkbox"
                  id="cleartext-plugin-toggle"
                  checked={!tlsOff && !!formData.enable_cleartext_plugin}
                  disabled={tlsOff}
                  onChange={(e) =>
                    updateField("enable_cleartext_plugin", e.target.checked)
                  }
                  className="accent-blue-500 w-3.5 h-3.5 rounded"
                />
                <span className="text-sm font-medium text-secondary">
                  {t("newConnection.enableCleartextPlugin", {
                    defaultValue: "Enable cleartext password plugin",
                  })}
                </span>
              </label>
              <p className="text-xs text-muted">
                {tlsOff
                  ? t("newConnection.enableCleartextPluginTlsRequired", {
                      defaultValue:
                        "Select an enforced TLS mode above (Required, Verify CA, or Verify Identity) to use the cleartext password plugin.",
                    })
                  : t("newConnection.enableCleartextPluginHint", {
                      defaultValue:
                        "Sends the password using mysql_clear_password. Required for bastions like Warpgate. Only used over a TLS connection.",
                    })}
              </p>
            </div>
          );
        })()}
    </div>
  );

  // ── rendered SSH tab content ──
  const sshTabContent = !isNetworkDriver ? (
    <p className="text-xs text-muted italic">
      {t("newConnection.sshNotAvailable", {
        defaultValue: "SSH is not available for this driver.",
      })}
    </p>
  ) : (
    <div className="space-y-4">
      {/* Enable toggle */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
        <input
          type="checkbox"
          id="ssh-toggle"
          checked={!!formData.ssh_enabled}
          onChange={(event) => {
            const enabled = event.target.checked;
            setFormData((previous) => ({
              ...previous,
              ssh_enabled: enabled,
              ssh_port:
                enabled && !previous.ssh_port ? 22 : previous.ssh_port,
              k8s_enabled:
                enabled && previous.k8s_enabled
                  ? false
                  : previous.k8s_enabled,
            }));
            if (enabled && formData.k8s_enabled) {
              invalidateK8sDiscovery();
              invalidateInlineK8sTest();
            }
          }}
          className="accent-blue-500 w-3.5 h-3.5 rounded"
        />
        <span className="text-sm font-medium text-secondary">
          {t("newConnection.useSsh")}
        </span>
      </label>

      {formData.ssh_enabled && (
        <div className="space-y-4">
          {/* Mode tabs */}
          <div className="flex rounded-md border border-strong overflow-hidden w-fit">
            {(["existing", "inline"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setSshMode(mode);
                  if (mode === "existing") {
                    updateField("ssh_host", undefined);
                    updateField("ssh_user", undefined);
                    updateField("ssh_password", undefined);
                    updateField("ssh_key_file", undefined);
                    updateField("ssh_key_passphrase", undefined);
                    setSshPasswordDirty(false);
                  } else {
                    updateField("ssh_connection_id", undefined);
                  }
                }}
                className={clsx(
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  sshMode === mode
                    ? "bg-blue-600 text-white"
                    : "bg-elevated text-secondary hover:text-primary",
                )}
              >
                {mode === "existing"
                  ? t("newConnection.useSshConnection")
                  : t("newConnection.createInlineSsh")}
              </button>
            ))}
          </div>

          {/* Existing SSH connection */}
          {sshMode === "existing" && (
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
                  {t("newConnection.selectSshConnection")}
                </label>
                <Select
                  value={formData.ssh_connection_id || null}
                  options={sshConnections.map((conn) => conn.id)}
                  labels={Object.fromEntries(
                    sshConnections.map((conn) => [
                      conn.id,
                      `${conn.name} (${conn.user}@${conn.host}:${conn.port})`,
                    ]),
                  )}
                  onChange={(val) => updateField("ssh_connection_id", val)}
                  placeholder={
                    sshConnections.length === 0
                      ? t("newConnection.noSshConnections")
                      : "-- " + t("newConnection.selectSshConnection") + " --"
                  }
                  searchable={false}
                />
              </div>
              <button
                type="button"
                onClick={() => setIsSshModalOpen(true)}
                className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
              >
                <Settings size={12} />
                {t("newConnection.manageSshConnections")}
              </button>
            </div>
          )}

          {/* Inline SSH config */}
          {sshMode === "inline" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <FieldInput
                  className="col-span-2"
                  label={t("newConnection.sshHost")}
                  value={formData.ssh_host}
                  onChange={(v) => updateField("ssh_host", v)}
                  placeholder="ssh.example.com"
                />
                <FieldInput
                  label={t("newConnection.sshPort")}
                  value={formData.ssh_port}
                  onChange={(v) => updateField("ssh_port", Number(v))}
                  type="number"
                  placeholder="22"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FieldInput
                  label={t("newConnection.sshUser")}
                  value={formData.ssh_user}
                  onChange={(v) => updateField("ssh_user", v)}
                  placeholder="user"
                />
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
                    {t("newConnection.sshPassword")}
                  </label>
                  <input
                    type="password"
                    value={formData.ssh_password ?? ""}
                    onChange={(e) => {
                      setSshPasswordDirty(true);
                      updateField("ssh_password", e.target.value);
                    }}
                    placeholder={
                      initialConnection &&
                      !sshPasswordDirty &&
                      !formData.ssh_password
                        ? "••••••••"
                        : t("newConnection.sshPasswordPlaceholder")
                    }
                    autoCorrect="off"
                    autoCapitalize="off"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted placeholder:italic focus:border-blue-500 focus:outline-none transition-colors"
                  />
                  {formData.save_in_keychain &&
                    sshPasswordDirty &&
                    !formData.ssh_password && (
                      <p className="text-[10px] text-amber-500 flex items-center gap-1 mt-0.5">
                        <AlertCircle size={10} />{" "}
                        {t("newConnection.sshPasswordMissing")}
                      </p>
                    )}
                </div>
              </div>
              <FieldInput
                label={t("newConnection.sshKeyFile")}
                value={formData.ssh_key_file}
                onChange={(v) => updateField("ssh_key_file", v)}
                placeholder={t("newConnection.sshKeyFilePlaceholder")}
              />
              <FieldInput
                label={t("newConnection.sshKeyPassphrase")}
                value={formData.ssh_key_passphrase}
                onChange={(v) => updateField("ssh_key_passphrase", v)}
                type="password"
                placeholder={t("newConnection.sshKeyPassphrasePlaceholder")}
              />
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  id="ssh-prompt-toggle"
                  checked={!!formData.ssh_allow_passphrase_prompt}
                  onChange={(e) =>
                    updateField("ssh_allow_passphrase_prompt", e.target.checked)
                  }
                  className="accent-blue-500 w-3.5 h-3.5 rounded cursor-pointer"
                />
                <label
                  htmlFor="ssh-prompt-toggle"
                  className="text-xs font-medium text-secondary cursor-pointer select-none"
                >
                  {t("newConnection.allowSshPrompt")}
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── rendered K8s tab content ──
  const k8sTabContent = !isNetworkDriver ? (
    <p className="text-xs text-muted italic">
      {t("newConnection.k8sNotAvailable", {
        defaultValue: "Kubernetes is not available for this driver.",
      })}
    </p>
  ) : (
    <div className="space-y-4">
      {/* Enable toggle */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
        <input
          type="checkbox"
          id="k8s-toggle"
          checked={!!formData.k8s_enabled}
          onChange={(event) => handleK8sEnabledChange(event.target.checked)}
          className="accent-blue-500 w-3.5 h-3.5 rounded"
        />
        <span className="text-sm font-medium text-secondary">
          {t("newConnection.useK8s", {
            defaultValue: "Use Kubernetes Port-Forward",
          })}
        </span>
      </label>

      {formData.k8s_enabled && (
        <div className="space-y-4">
          {/* Mode tabs */}
          <div className="flex rounded-md border border-strong overflow-hidden w-fit">
            {(["existing", "inline"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => handleK8sModeChange(mode)}
                className={clsx(
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  k8sMode === mode
                    ? "bg-blue-600 text-white"
                    : "bg-elevated text-secondary hover:text-primary",
                )}
              >
                {mode === "existing"
                  ? t("newConnection.useK8sConnection", {
                      defaultValue: "Saved Connection",
                    })
                  : t("newConnection.createInlineK8s", {
                      defaultValue: "Inline",
                    })}
              </button>
            ))}
          </div>

          {/* Existing K8s connection */}
          {k8sMode === "existing" && (
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
                  {t("newConnection.selectK8sConnection", {
                    defaultValue: "Select K8s Connection",
                  })}
                </label>
                <div className="flex items-center gap-2">
                  <Select
                    className="flex-1"
                    value={formData.k8s_connection_id || null}
                    options={k8sConnections.map((conn) => conn.id)}
                    labels={Object.fromEntries(
                      k8sConnections.map((conn) => [
                        conn.id,
                        `${conn.name} (${conn.context}/${conn.namespace}/${conn.resource_name}:${conn.port})`,
                      ]),
                    )}
                    onChange={handleSavedK8sConnectionChange}
                    searchPlaceholder={t("common.search")}
                    noResultsLabel={t("common.noResults")}
                    placeholder={
                      k8sConnections.length === 0
                        ? t("newConnection.noK8sConnections", {
                            defaultValue: "No saved connections — create one below",
                          })
                        : t("newConnection.chooseK8s", {
                            defaultValue: "Choose a connection...",
                          })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setIsK8sModalOpen(true)}
                    className="px-2.5 py-1.5 text-xs bg-surface-secondary hover:bg-surface-tertiary rounded-md text-secondary transition-colors"
                  >
                    {t("newConnection.manageK8s", {
                      defaultValue: "Manage",
                    })}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Inline K8s fields */}
          {k8sMode === "inline" && (
            <div className="space-y-3">
              <K8sAdvancedSettings pathOverrides={pathOverrides} />
              {k8sPathActionError && (
                <p role="alert" className="text-xs text-red-400">
                  {k8sPathActionError}
                </p>
              )}
              {k8sSelectionError && (
                <p role="alert" className="text-xs text-red-400">
                  {k8sSelectionError}
                </p>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
                  {t("newConnection.k8sContext", {
                    defaultValue: "Context",
                  })}
                </label>
                <Select
                  value={formData.k8s_context || null}
                  options={k8sContexts}
                  onChange={handleInlineContextChange}
                  searchPlaceholder={t("common.search")}
                  noResultsLabel={t("common.noResults")}
                  placeholder={
                    k8sContexts.length === 0
                      ? t("k8sConnections.noContexts")
                      : t("newConnection.chooseContext", {
                          defaultValue: "Choose a context...",
                        })
                  }
                />
                {k8sDiscoveryErrors.contexts && (
                  <p role="alert" className="text-xs text-red-400">
                    {k8sDiscoveryErrors.contexts}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
                  {t("newConnection.k8sNamespace", {
                    defaultValue: "Namespace",
                  })}
                </label>
                <Select
                  value={formData.k8s_namespace || null}
                  options={k8sNamespaces}
                  onChange={handleInlineNamespaceChange}
                  searchPlaceholder={t("common.search")}
                  noResultsLabel={t("common.noResults")}
                  placeholder={
                    k8sNamespaces.length === 0
                      ? t("k8sConnections.noNamespaces")
                      : t("newConnection.chooseNamespace", {
                          defaultValue: "Choose a namespace...",
                        })
                  }
                />
                {k8sDiscoveryErrors.namespaces && (
                  <p role="alert" className="text-xs text-red-400">
                    {k8sDiscoveryErrors.namespaces}
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
                    {t("newConnection.k8sResourceType", {
                      defaultValue: "Resource Type",
                    })}
                  </label>
                  <Select
                    value={formData.k8s_resource_type || null}
                    options={["service", "pod"]}
                    labels={{
                      service: t("newConnection.k8sResourceTypeService", {
                        defaultValue: "Service",
                      }),
                      pod: t("newConnection.k8sResourceTypePod", {
                        defaultValue: "Pod",
                      }),
                    }}
                    onChange={handleInlineResourceTypeChange}
                    placeholder={t("newConnection.k8sSelectType", {
                      defaultValue: "Select type...",
                    })}
                    searchable={false}
                  />
                </div>

                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
                    {t("newConnection.k8sResourceName", {
                      defaultValue: "Resource Name",
                    })}
                  </label>
                  <Select
                    value={formData.k8s_resource_name || null}
                    options={k8sResources}
                    onChange={handleInlineResourceNameChange}
                    searchPlaceholder={t("common.search")}
                    noResultsLabel={t("common.noResults")}
                    placeholder={
                      k8sResources.length === 0
                        ? t("k8sConnections.noResources")
                        : t("newConnection.chooseResource", {
                            defaultValue: "Choose a resource...",
                          })
                    }
                  />
                  {k8sDiscoveryErrors.resources && (
                    <p role="alert" className="text-xs text-red-400">
                      {k8sDiscoveryErrors.resources}
                    </p>
                  )}
                </div>
              </div>

              <FieldInput
                label={t("newConnection.k8sPort", {
                  defaultValue: "Container Port",
                })}
                value={effectiveK8sPort ?? ""}
                type="number"
                onChange={handleInlinePortChange}
                placeholder={
                  k8sDefaultPort != null ? String(k8sDefaultPort) : undefined
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      overlayClassName="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm"
    >
      <fieldset
        disabled={isPersistencePending}
        aria-busy={isPersistencePending}
        className={clsx(
          "bg-elevated border border-strong rounded-xl shadow-2xl w-[900px] max-w-[92vw] max-h-[90vh] flex flex-col overflow-hidden p-0 m-0 min-w-0",
          isPersistencePending && "pointer-events-none",
        )}
      >
        {/* ── Top bar: step-aware title / name + progress + close ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-default bg-base">
          {step === "form" ? (
            <>
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={getDriverColorStyle(activeDriver)}
              />
              <input
                ref={nameInputRef}
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(false);
                }}
                placeholder={t("newConnection.namePlaceholder")}
                autoFocus
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                className={clsx(
                  "flex-1 bg-transparent text-base font-semibold outline-none",
                  nameError
                    ? "text-red-400 placeholder:text-red-400/60"
                    : "text-primary placeholder:text-muted/50",
                )}
              />
            </>
          ) : (
            <h2 className="flex-1 truncate text-base font-semibold text-primary">
              {pendingGroup
                ? t("newConnection.selectDriverTitle", {
                    defaultValue: "Select a driver",
                  })
                : t("newConnection.chooseTitle", {
                    defaultValue: "Choose a database",
                  })}
            </h2>
          )}

          {/* Progress indicator (new connection only) */}
          {!isEditing && (
            <div className="hidden items-center gap-2 shrink-0 sm:flex">
              <span
                className={clsx(
                  "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                  step === "catalogue"
                    ? "bg-blue-500/15 text-blue-400"
                    : "text-secondary",
                )}
              >
                <span
                  className={clsx(
                    "flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold",
                    step === "catalogue"
                      ? "bg-blue-500 text-white"
                      : "bg-green-500/80 text-white",
                  )}
                >
                  {step === "catalogue" ? "1" : <Check size={10} />}
                </span>
                {t("newConnection.stepChoose", { defaultValue: "Choose" })}
              </span>
              <span className="h-px w-4 bg-default" />
              <span
                className={clsx(
                  "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                  step === "form"
                    ? "bg-blue-500/15 text-blue-400"
                    : "text-muted",
                )}
              >
                <span
                  className={clsx(
                    "flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold",
                    step === "form"
                      ? "bg-blue-500 text-white"
                      : "bg-surface-secondary text-muted",
                  )}
                >
                  2
                </span>
                {t("newConnection.stepConfigure", { defaultValue: "Configure" })}
              </span>
            </div>
          )}

          <button
            onClick={handleClose}
            className="p-1.5 text-muted hover:text-primary hover:bg-surface-secondary rounded-md transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Main body ── */}
        {step === "catalogue" ? (
          pendingGroup ? (
            <DriverVersionPicker
              group={pendingGroup}
              onChoose={(d) => goToForm(d)}
              onBack={() => setPendingGroup(null)}
            />
          ) : (
            <ConnectionCatalogue
              groups={catalogue.groups}
              facets={catalogue.facets}
              loading={catalogue.loading}
              registryOffline={catalogue.registryOffline}
              onSelect={handleEngineSelect}
            />
          )
        ) : activeDriverNotInstalled && activeCatalogueDriver ? (
          /* ── install gate: selected driver isn't installed yet ── */
          <InstallGate
            driver={activeCatalogueDriver}
            status={installStatus}
            error={installError}
            onInstall={(slug, version) => void installDriver(slug, version)}
            onBack={() => setStep("catalogue")}
          />
        ) : (
          /* ── form step: driver identity header + tabbed form ── */
          <div className="flex flex-1 min-h-0 flex-col">
            {/* Driver identity header */}
            <div className="flex items-center gap-3 border-b border-default bg-base/40 px-5 py-3">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-sm"
                style={{ backgroundColor: `${driverAccent}1f`, color: driverAccent }}
              >
                {renderDriverGlyph(22)}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold capitalize text-primary">
                    {activeDriver?.name ?? driver}
                  </h3>
                  {activeCatalogueDriver?.verified && (
                    <span className="flex items-center text-blue-400" title="Verified">
                      <ShieldCheck size={14} />
                      <span className="sr-only">Verified</span>
                    </span>
                  )}
                  {activeDriver && activeDriver.is_builtin !== true && (
                    <span className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted">
                      v{activeDriver.version}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {(activeCatalogueDriver?.paradigms ?? []).map((p) => (
                    <span
                      key={p}
                      className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                      style={{
                        backgroundColor: `${paradigmAccent(p)}1f`,
                        color: paradigmAccent(p),
                      }}
                    >
                      {p}
                    </span>
                  ))}
                  {activeDriver?.description && (
                    <span className="truncate text-[11px] text-muted">
                      {activeDriver.description}
                    </span>
                  )}
                </div>
              </div>
              {!isEditing && (
                <button
                  type="button"
                  onClick={() => setStep("catalogue")}
                  className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-strong bg-elevated px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:bg-surface-secondary hover:text-primary"
                >
                  <ArrowLeft size={12} />
                  {t("newConnection.changeDatabase", {
                    defaultValue: "Change database",
                  })}
                </button>
              )}
            </div>

            {/* Tab bar */}
            <div className="relative">
            <div
              ref={tabBarRef}
              onScroll={updateTabFade}
              style={{
                maskImage:
                  tabFade.left || tabFade.right
                    ? `linear-gradient(to right, ${tabFade.left ? "transparent" : "black"}, black 28px, black calc(100% - 28px), ${tabFade.right ? "transparent" : "black"})`
                    : undefined,
                WebkitMaskImage:
                  tabFade.left || tabFade.right
                    ? `linear-gradient(to right, ${tabFade.left ? "transparent" : "black"}, black 28px, black calc(100% - 28px), ${tabFade.right ? "transparent" : "black"})`
                    : undefined,
              }}
              className="flex items-center border-b border-default px-5 bg-base/50 overflow-x-auto no-scrollbar scroll-smooth"
            >
              {(
                [
                  {
                    id: "general",
                    label: t("newConnection.general", {
                      defaultValue: "General",
                    }),
                  },
                  ...(isMultiDb
                    ? [
                        {
                          id: "databases",
                          label: t("newConnection.selectDatabases"),
                        },
                      ]
                    : []),
                  ...(activeDriver?.capabilities?.supports_ssl && isNetworkDriver
                    ? [{ id: "ssl", label: "SSL" }]
                    : []),
                  ...(isNetworkDriver ? [{ id: "ssh", label: "SSH" }] : []),
                  ...(isNetworkDriver ? [{ id: "k8s", label: "Kubernetes" }] : []),
                  {
                    id: "advanced",
                    label: t("newConnection.advanced", {
                      defaultValue: "Advanced",
                    }),
                  },
                  {
                    id: "appearance",
                    label: t("newConnection.appearance", {
                      defaultValue: "Appearance",
                    }),
                  },
                ] as {
                  id:
                    | "general"
                    | "databases"
                    | "ssh"
                    | "ssl"
                    | "k8s"
                    | "advanced"
                    | "appearance";
                  label: string;
                }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  data-active={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    "cursor-pointer flex-shrink-0 whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 -mb-px",
                    activeTab === tab.id
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-muted hover:text-secondary",
                  )}
                >
                  {tab.label}
                  {tab.id === "databases" &&
                    selectedDatabasesState.length > 0 && (
                      <span className="ml-1.5 text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">
                        {selectedDatabasesState.length}
                      </span>
                    )}
                  {tab.id === "databases" &&
                    databasesTabError &&
                    selectedDatabasesState.length === 0 && (
                      <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                    )}
                </button>
              ))}
            </div>
              {tabFade.left && (
                <button
                  type="button"
                  aria-label={t("newConnection.scrollTabsLeft", { defaultValue: "Scroll tabs left" })}
                  onClick={() => scrollTabs(-1)}
                  className="absolute left-1 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-6 h-6 rounded-full bg-elevated text-muted shadow ring-1 ring-default hover:text-primary transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
              )}
              {tabFade.right && (
                <button
                  type="button"
                  aria-label={t("newConnection.scrollTabsRight", { defaultValue: "Scroll tabs right" })}
                  onClick={() => scrollTabs(1)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-6 h-6 rounded-full bg-elevated text-muted shadow ring-1 ring-default hover:text-primary transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              )}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-5">
              {activeTab === "general"
                ? generalTabContent
                : activeTab === "databases"
                  ? databasesTabContent
                  : activeTab === "ssl"
                    ? sslTabContent
                    : activeTab === "k8s"
                      ? k8sTabContent
                      : activeTab === "ssh"
                        ? sshTabContent
                        : activeTab === "advanced"
                          ? advancedTabContent
                          : appearanceTabContent}
            </div>
          </div>
        )}

        {/* ── Footer: test status + actions (form step only) ── */}
        {step === "form" && !activeDriverNotInstalled && <div className="border-t border-default bg-base px-5 py-3 flex items-center gap-3">
          {/* Test button */}
          <button
            onClick={testConnection}
            disabled={
              isActionPending || status === "testing" || status === "saving"
            }
            className={clsx(
              "flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors disabled:opacity-50",
              testResult === "success"
                ? "border-green-600/50 bg-green-900/20 text-green-400"
                : testResult === "error"
                  ? "border-red-600/50 bg-red-900/20 text-red-400"
                  : "border-strong bg-elevated text-secondary hover:text-primary hover:bg-surface-secondary",
            )}
          >
            {status === "testing" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : testResult === "success" ? (
              <Check size={14} />
            ) : testResult === "error" ? (
              <XCircle size={14} />
            ) : (
              <Plug size={14} />
            )}
            {t("newConnection.testConnection")}
          </button>

          {/* Status message */}
          <p
            aria-live="polite"
            aria-atomic="true"
            className={clsx(
              "flex-1 text-xs truncate",
              testResult === "success" ? "text-green-400" : "text-red-400",
            )}
          >
            {message ?? ""}
          </p>

          {/* Cancel + Save */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-sm text-secondary hover:text-primary hover:bg-surface-secondary rounded-md border border-strong transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={saveConnection}
              disabled={isActionPending || status === "saving"}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
            >
              {status === "saving" && (
                <Loader2 size={14} className="animate-spin" />
              )}
              {t("newConnection.save")}
            </button>
          </div>
        </div>}
      </fieldset>

      {/* SSH Management Modal */}
      <SshConnectionsModal
        isOpen={isSshModalOpen}
        onClose={async () => {
          setIsSshModalOpen(false);
          await loadSshConnectionsList();
        }}
      />
      <K8sConnectionsModal
        isOpen={isK8sModalOpen}
        onClose={async () => {
          setIsK8sModalOpen(false);
          await loadK8sConnectionsList();
        }}
        defaultPort={k8sDefaultPort}
      />
    </Modal>
  );
};
