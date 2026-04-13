import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Check,
  AlertCircle,
  Loader2,
  Database,
  Settings,
  XCircle,
  FolderOpen,
  CheckSquare,
  Square,
  Plug,
  Info,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { SshConnectionsModal } from "./SshConnectionsModal";
import { Select } from "../ui/Select";
import { SlotAnchor } from "../ui/SlotAnchor";
import { useDrivers } from "../../hooks/useDrivers";
import { usePluginSlotRegistry } from "../../hooks/usePluginSlotRegistry";
import { Modal } from "../ui/Modal";
import type { PluginManifest } from "../../types/plugins";
import { loadSshConnections, type SshConnection } from "../../utils/ssh";
import { isMultiDatabaseCapable } from "../../utils/database";
import { fetchConnectionWithCredentials } from "../../utils/credentials";
import { getDriverIcon, getDriverColorStyle } from "../../utils/driverUI";
import {
  looksLikeConnectionString,
  parseConnectionString,
  toConnectionParams,
} from "../../utils/connectionStringParser";

interface ConnectionParams {
  driver: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database: string | string[];
  ssl_mode?: string;
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
  save_in_keychain?: boolean;
}

interface SavedConnection {
  id: string;
  name: string;
  params: ConnectionParams;
}

interface NewConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  initialConnection?: SavedConnection | null;
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
}) => (
  <div className={clsx("flex flex-col gap-1", className)}>
    <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
      {label}
    </label>
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoCorrect="off"
      autoCapitalize="off"
      autoComplete="off"
      spellCheck={false}
      className="w-full px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none transition-colors"
    />
  </div>
);

export const NewConnectionModal = ({
  isOpen,
  onClose,
  onSave,
  initialConnection,
}: NewConnectionModalProps) => {
  const { t } = useTranslation();
  const { drivers } = useDrivers();

  // ── form state ──
  const [driver, setDriver] = useState<string>("mysql");
  const activeDriver = drivers.find((d) => d.id === driver) ?? drivers[0];
  const [name, setName] = useState("");
  const [formData, setFormData] = useState<Partial<ConnectionParams>>({
    host: "localhost",
    port: 3306,
    username: "",
    database: "",
    ssl_mode: "",
    ssh_enabled: false,
    ssh_port: 22,
  });
  const [selectedDatabasesState, setSelectedDatabasesState] = useState<
    string[]
  >([]);
  const [dbSearchQuery, setDbSearchQuery] = useState("");
  const [passwordDirty, setPasswordDirty] = useState(false);
  const [sshPasswordDirty, setSshPasswordDirty] = useState(false);
  const [connectionString, setConnectionString] = useState("");
  const [connectionStringError, setConnectionStringError] = useState<
    string | null
  >(null);

  // ── tab ──
  const [activeTab, setActiveTab] = useState<"general" | "databases" | "ssh">(
    "general",
  );

  // ── SSH ──
  const [sshConnections, setSshConnections] = useState<SshConnection[]>([]);
  const [isSshModalOpen, setIsSshModalOpen] = useState(false);
  const [sshMode, setSshMode] = useState<"existing" | "inline">("existing");

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

  // ── validation errors ──
  const [nameError, setNameError] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [databasesTabError, setDatabasesTabError] = useState(false);

  // ── capabilities ──
  const noConnectionRequired =
    activeDriver?.capabilities?.no_connection_required === true;
  const isNetworkDriver =
    !noConnectionRequired &&
    activeDriver?.capabilities?.file_based === false &&
    !activeDriver?.capabilities?.folder_based;
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

  const updateField = (
    field: keyof ConnectionParams,
    value: string | number | boolean | undefined,
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const loadDatabases = async (overrides?: Partial<ConnectionParams>) => {
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
      const listParams: Partial<ConnectionParams> = {
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
      const databases = await invoke<string[]>("list_databases", {
        request: {
          params: { ...listParams },
          connection_id: initialConnection?.id,
        },
      });
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
      const errorMsg =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : t("newConnection.failLoadDatabases");
      setDatabaseLoadError(errorMsg);
      setAvailableDatabases([]);
    } finally {
      setLoadingDatabases(false);
    }
  };

  // ── init form on open ──
  useEffect(() => {
    if (!isOpen) return;
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

      if (initialConnection) {
        setName(initialConnection.name);
        setDriver(initialConnection.params.driver);
        const db = initialConnection.params.database;
        setSshMode(
          initialConnection.params.ssh_connection_id ? "existing" : "inline",
        );

        let params = initialConnection.params;
        try {
          const fullConn = await fetchConnectionWithCredentials(
            initialConnection.id,
          );
          params = fullConn.params;
        } catch {
          // fallback: use params without secrets (backend will retrieve from keychain)
        }

        if (Array.isArray(db)) {
          setSelectedDatabasesState(db);
          setFormData({ ...params, database: db[0] ?? "" });
        } else {
          setSelectedDatabasesState([]);
          setFormData({ ...params });
        }

        // Auto-load available databases when editing a multi-db connection
        const editDriver = drivers.find(
          (d) => d.id === initialConnection.params.driver,
        );
        if (isMultiDatabaseCapable(editDriver?.capabilities)) {
          loadDatabases(params);
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
        });
        setSelectedDatabasesState([]);
        setSshMode("existing");
      }

      await loadSshConnectionsList();
    };
    void init();
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
    });
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
  };

  const testConnection = async () => {
    setStatus("testing");
    setMessage("");
    setTestResult(null);
    try {
      const testParams: Partial<ConnectionParams> = {
        driver,
        ...formData,
        port: formData.port != null ? Number(formData.port) : undefined,
        database: isMultiDb
          ? (selectedDatabasesState[0] ??
            (typeof formData.database === "string" ? formData.database : ""))
          : formData.database,
      };
      const result = await invoke<string>("test_connection", {
        request: {
          params: { ...testParams },
          connection_id: initialConnection?.id,
        },
      });
      setStatus("success");
      setMessage(result);
      setTestResult("success");
      setTimeout(() => {
        setTestResult(null);
        setStatus("idle");
        setMessage("");
      }, 3000);
      return true;
    } catch (err) {
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
        setTestResult(null);
        setStatus("idle");
      }, 3000);
      return false;
    }
  };

  const saveConnection = async () => {
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
      (!formData.database ||
        (typeof formData.database === "string" && !formData.database.trim()))
    ) {
      setStatus("error");
      setMessage(t("newConnection.dbNameRequired"));
      setTestResult("error");
      return;
    }
    setStatus("saving");
    setMessage("");
    setTestResult(null);
    try {
      const params: Partial<ConnectionParams> = {
        driver,
        ...formData,
        port: formData.port != null ? Number(formData.port) : undefined,
        database: isMultiDb
          ? selectedDatabasesState.length === 1
            ? selectedDatabasesState[0]
            : selectedDatabasesState
          : formData.database,
      };
      if (initialConnection) {
        if (!params.password?.trim()) delete params.password;
        if (!params.ssh_password?.trim()) delete params.ssh_password;
        await invoke("update_connection", {
          id: initialConnection.id,
          name,
          params,
        });
      } else {
        await invoke("save_connection", { name, params });
      }
      if (onSave) onSave();
      onClose();
    } catch (err) {
      setStatus("error");
      setMessage(typeof err === "string" ? err : t("newConnection.failSave"));
      setTestResult("error");
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

    if (looksLikeConnectionString(value, parserDrivers)) {
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
          setActiveTab("databases");
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
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted">
            <Info size={22} className="opacity-40" />
            <p className="text-xs text-center">
              {t("newConnection.noGeneralSettings", {
                defaultValue: "No general settings available for this driver.",
              })}
            </p>
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
              className="flex-1 px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none transition-colors"
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
                    "flex-1 px-3 py-2 bg-base border rounded-md text-sm text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none transition-colors",
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
            {driver === "postgres" && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-semibold tracking-wider text-muted">
                  {t("newConnection.sslMode", { defaultValue: "SSL Mode" })}
                </label>
                <Select
                  value={formData.ssl_mode || "prefer"}
                  options={["disable", "allow", "prefer", "require"]}
                  labels={{
                    disable: t("newConnection.sslModes.disable"),
                    allow: t("newConnection.sslModes.allow"),
                    prefer: t("newConnection.sslModes.prefer"),
                    require: t("newConnection.sslModes.require"),
                  }}
                  onChange={(v) => updateField("ssl_mode", v)}
                  searchable={false}
                />
              </div>
            )}
          </div>

          {/* User + Password */}
          <div className="grid grid-cols-2 gap-3">
            <FieldInput
              label={t("newConnection.username")}
              value={formData.username}
              onChange={(v) => updateField("username", v)}
              placeholder="root"
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
          {!isMultiDb && (
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
                  className="w-full px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none transition-colors"
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
          onChange={(e) => {
            const enabled = e.target.checked;
            updateField("ssh_enabled", enabled);
            if (enabled && !formData.ssh_port) updateField("ssh_port", 22);
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
                <select
                  value={formData.ssh_connection_id || ""}
                  onChange={(e) =>
                    updateField("ssh_connection_id", e.target.value)
                  }
                  className="w-full px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary focus:border-blue-500 focus:outline-none appearance-auto cursor-pointer transition-colors"
                >
                  <option value="">
                    {sshConnections.length === 0
                      ? t("newConnection.noSshConnections")
                      : "-- " + t("newConnection.selectSshConnection") + " --"}
                  </option>
                  {sshConnections.map((conn) => (
                    <option key={conn.id} value={conn.id}>
                      {conn.name} ({conn.user}@{conn.host}:{conn.port})
                    </option>
                  ))}
                </select>
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
                    className="w-full px-3 py-2 bg-base border border-strong rounded-md text-sm text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none transition-colors"
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
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      overlayClassName="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm"
    >
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[760px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* ── Top bar: name + close ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-default bg-base">
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
          <span className="text-xs text-muted bg-surface-secondary px-2 py-0.5 rounded-full font-medium capitalize">
            {activeDriver?.name ?? driver}
          </span>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-primary hover:bg-surface-secondary rounded-md transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Main body: left driver list + right form ── */}
        <div className="flex flex-1 min-h-0">
          {/* Left: driver list */}
          <div className="w-[160px] shrink-0 border-r border-default bg-base flex flex-col py-2 overflow-y-auto">
            {(() => {
              const sortedDrivers = [...drivers].sort((a, b) => {
                const aBuiltin = a.is_builtin === true ? 0 : 1;
                const bBuiltin = b.is_builtin === true ? 0 : 1;
                return aBuiltin - bBuiltin;
              });
              const firstExternalIdx = sortedDrivers.findIndex(
                (d) => !d.is_builtin,
              );
              return (
                <>
                  <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {t("newConnection.dbType")}
                  </p>
                  {sortedDrivers.map((d: PluginManifest, idx) => (
                    <div key={d.id}>
                      {/* Separator before first external plugin */}
                      {idx === firstExternalIdx && (
                        <div className="px-3 pt-2.5 pb-1">
                          <div className="flex items-center gap-2">
                            <div className="h-px flex-1 bg-default/60" />
                            <span className="text-[9px] font-bold uppercase tracking-widest text-muted/60">
                              Plugins
                            </span>
                            <div className="h-px flex-1 bg-default/60" />
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => handleDriverChange(d.id)}
                        className={clsx(
                          "flex items-center gap-2.5 px-3 py-2 text-sm font-medium transition-colors text-left w-full",
                          driver === d.id
                            ? "bg-blue-500/15 text-primary border-r-2 border-blue-500"
                            : "text-secondary hover:bg-surface-secondary hover:text-primary border-r-2 border-transparent",
                        )}
                      >
                        <span
                          className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-white"
                          style={getDriverColorStyle(d)}
                        >
                          {getDriverIcon(d)}
                        </span>
                        <span className="truncate capitalize">{d.name}</span>
                      </button>
                    </div>
                  ))}
                </>
              );
            })()}
          </div>

          {/* Right: form area */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/* Tab bar */}
            <div className="flex items-center border-b border-default px-5 bg-base/50">
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
                  ...(isNetworkDriver ? [{ id: "ssh", label: "SSH" }] : []),
                ] as { id: "general" | "databases" | "ssh"; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    "px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 -mb-px",
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

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-5">
              {activeTab === "general"
                ? generalTabContent
                : activeTab === "databases"
                  ? databasesTabContent
                  : sshTabContent}
            </div>
          </div>
        </div>

        {/* ── Footer: test status + actions ── */}
        <div className="border-t border-default bg-base px-5 py-3 flex items-center gap-3">
          {/* Test button */}
          <button
            onClick={testConnection}
            disabled={status === "testing" || status === "saving"}
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
          {message && (
            <p
              className={clsx(
                "flex-1 text-xs truncate",
                testResult === "success" ? "text-green-400" : "text-red-400",
              )}
            >
              {message}
            </p>
          )}
          {!message && <div className="flex-1" />}

          {/* Cancel + Save */}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-secondary hover:text-primary hover:bg-surface-secondary rounded-md border border-strong transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={saveConnection}
              disabled={status === "saving"}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
            >
              {status === "saving" && (
                <Loader2 size={14} className="animate-spin" />
              )}
              {t("newConnection.save")}
            </button>
          </div>
        </div>
      </div>

      {/* SSH Management Modal */}
      <SshConnectionsModal
        isOpen={isSshModalOpen}
        onClose={async () => {
          setIsSshModalOpen(false);
          await loadSshConnectionsList();
        }}
      />
    </Modal>
  );
};
