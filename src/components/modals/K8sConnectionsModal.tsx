import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Plus,
  Edit2,
  Trash2,
  Check,
  Loader2,
  Zap,
  XCircle,
} from "lucide-react";
import {
  loadK8sConnections,
  saveK8sConnection,
  updateK8sConnection,
  deleteK8sConnection,
  testK8sConnection,
  getK8sContexts,
  getK8sNamespaces,
  getK8sResources,
  getK8sResourcePorts,
  validateK8sConnection,
  type K8sConnection,
  type K8sConnectionInput,
} from "../../utils/k8s";
import { toErrorMessage } from "../../utils/errors";
import { Modal } from "../ui/Modal";
import { Select } from "../ui/Select";
import clsx from "clsx";

interface K8sConnectionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPort?: number | null;
}

const InputClass =
  "w-full px-3 pt-2 pb-1 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none leading-tight";
const LabelClass = "block text-xs uppercase font-bold text-muted mb-1";

export function K8sConnectionsModal({
  isOpen,
  onClose,
  defaultPort,
}: K8sConnectionsModalProps) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<K8sConnection[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [namespace, setNamespace] = useState("");
  const [resourceType, setResourceType] = useState<string>("service");
  const [resourceName, setResourceName] = useState("");
  const effectiveDefaultPort = defaultPort ?? undefined;
  const [port, setPort] = useState<number | undefined>(undefined);
  const effectivePort = port ?? effectiveDefaultPort;
  const [isPortOverridden, setIsPortOverridden] = useState(false);

  // Discovery state
  const [contexts, setContexts] = useState<string[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [resources, setResources] = useState<string[]>([]);

  // Status
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    const result = await loadK8sConnections();
    setConnections(result);
  }, []);

  const loadContexts = useCallback(async () => {
    try {
      const result = await getK8sContexts();
      setContexts(result);
    } catch {
      setContexts([]);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    void (async () => {
      await loadConnections();
      await loadContexts();
    })();
  }, [isOpen, loadConnections, loadContexts]);

  useEffect(() => {
    void (async () => {
      if (!context) {
        setNamespaces([]);
        return;
      }

      try {
        setNamespaces(await getK8sNamespaces(context));
      } catch {
        setNamespaces([]);
      }
    })();
  }, [context]);

  useEffect(() => {
    void (async () => {
      if (!context || !namespace || !resourceType) {
        setResources([]);
        return;
      }

      try {
        setResources(await getK8sResources(context, namespace, resourceType));
      } catch {
        setResources([]);
      }
    })();
  }, [context, namespace, resourceType]);

  useEffect(() => {
    if (
      !context ||
      !namespace ||
      resourceType !== "service" ||
      !resourceName ||
      isPortOverridden
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const ports = await getK8sResourcePorts(
          context,
          namespace,
          resourceType,
          resourceName,
        );
        if (!cancelled && ports.length === 1) {
          setPort((prev) => (prev === ports[0] ? prev : ports[0]));
        }
      } catch {
        // Best-effort convenience only: keep the current/default port.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context, namespace, resourceType, resourceName, isPortOverridden]);

  const resetForm = () => {
    setName("");
    setContext("");
    setNamespace("");
    setResourceType("service");
    setResourceName("");
    setPort(undefined);
    setIsPortOverridden(false);
    setTestStatus("idle");
    setTestMessage("");
    setValidationError(null);
  };

  const handleCreate = () => {
    resetForm();
    setIsCreating(true);
    setEditingId(null);
  };

  const handleEdit = (conn: K8sConnection) => {
    setName(conn.name);
    setContext(conn.context);
    setNamespace(conn.namespace);
    setResourceType(conn.resource_type);
    setResourceName(conn.resource_name);
    setPort(conn.port);
    setIsPortOverridden(true);
    setEditingId(conn.id);
    setIsCreating(false);
    setTestStatus("idle");
    setTestMessage("");
    setValidationError(null);
  };

  const handleCancel = () => {
    resetForm();
    setEditingId(null);
    setIsCreating(false);
  };

  const handleSave = async () => {
    const validation = validateK8sConnection({
      name,
      context,
      namespace,
      resource_type: resourceType,
      resource_name: resourceName,
      port: effectivePort,
    });
    if (!validation.isValid) {
      setValidationError(t(validation.errorKey));
      return;
    }
    const input: K8sConnectionInput = validation.value;

    try {
      if (isCreating) {
        await saveK8sConnection(input);
      } else if (editingId) {
        await updateK8sConnection(editingId, input);
      }
      await loadConnections();
      handleCancel();
    } catch (error) {
      setValidationError(toErrorMessage(error));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteK8sConnection(id);
      await loadConnections();
      if (editingId === id) handleCancel();
    } catch (error) {
      console.error("Failed to delete K8s connection:", error);
    }
  };

  const handleTest = async () => {
    if (!context || !namespace) return;
    setTestStatus("testing");
    try {
      const result = await testK8sConnection(context, namespace);
      setTestStatus("success");
      setTestMessage(result);
    } catch (error) {
      setTestStatus("error");
      setTestMessage(toErrorMessage(error));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      overlayClassName="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm"
    >
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-default bg-base">
          <h2 className="text-sm font-semibold text-primary">
            {t("k8sConnections.title", {
              defaultValue: "Kubernetes Connections",
            })}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
            >
              <Plus size={12} />
              {t("k8sConnections.add", { defaultValue: "Add" })}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-muted hover:text-primary hover:bg-surface-secondary rounded-md transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {/* Connection list */}
          {connections.map((conn) =>
            editingId === conn.id ? (
              /* Inline edit form */
              <div
                key={conn.id}
                className="border border-blue-500/30 rounded-lg p-4 bg-base/50 space-y-3"
              >
                {/* Edit form — same fields as create */}
                <EditForm
                  name={name}
                  setName={setName}
                  context={context}
                  setContext={setContext}
                  namespace={namespace}
                  setNamespace={setNamespace}
                  resourceType={resourceType}
                  setResourceType={setResourceType}
                  resourceName={resourceName}
                  setResourceName={setResourceName}
                  port={effectivePort}
                  setPort={(value) => {
                    setIsPortOverridden(value != null);
                    setPort(value);
                  }}
                  defaultPort={effectiveDefaultPort}
                  contexts={contexts}
                  namespaces={namespaces}
                  resources={resources}
                  validationError={validationError}
                  testStatus={testStatus}
                  testMessage={testMessage}
                  onTest={handleTest}
                  onSave={handleSave}
                  onCancel={handleCancel}
                />
              </div>
            ) : (
              <div
                key={conn.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-base border border-default hover:border-strong transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-primary truncate">
                    {conn.name}
                  </div>
                  <div className="text-xs text-muted truncate">
                    {conn.context}/{conn.namespace}/{conn.resource_type}/{conn.resource_name}:{conn.port}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleEdit(conn)}
                    className="p-1.5 text-muted hover:text-primary hover:bg-surface-secondary rounded transition-colors"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(conn.id)}
                    className="p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          )}

          {/* Create form */}
          {isCreating && (
            <div className="border border-blue-500/30 rounded-lg p-4 bg-base/50 space-y-3">
              <EditForm
                name={name}
                setName={setName}
                context={context}
                setContext={setContext}
                namespace={namespace}
                setNamespace={setNamespace}
                resourceType={resourceType}
                setResourceType={setResourceType}
                resourceName={resourceName}
                setResourceName={setResourceName}
                port={effectivePort}
                setPort={(value) => {
                  setIsPortOverridden(value != null);
                  setPort(value);
                }}
                defaultPort={effectiveDefaultPort}
                contexts={contexts}
                namespaces={namespaces}
                resources={resources}
                validationError={validationError}
                testStatus={testStatus}
                testMessage={testMessage}
                onTest={handleTest}
                onSave={handleSave}
                onCancel={handleCancel}
              />
            </div>
          )}

          {/* Empty state */}
          {connections.length === 0 && !isCreating && (
            <p className="text-xs text-muted italic text-center py-6">
              {t("k8sConnections.empty", {
                defaultValue:
                  "No Kubernetes connections saved. Click \"Add\" to create one.",
              })}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Shared edit form ──

interface EditFormProps {
  name: string;
  setName: (v: string) => void;
  context: string;
  setContext: (v: string) => void;
  namespace: string;
  setNamespace: (v: string) => void;
  resourceType: string;
  setResourceType: (v: string) => void;
  resourceName: string;
  setResourceName: (v: string) => void;
  port: number | undefined;
  setPort: (v: number | undefined) => void;
  defaultPort?: number;
  contexts: string[];
  namespaces: string[];
  resources: string[];
  validationError: string | null;
  testStatus: "idle" | "testing" | "success" | "error";
  testMessage: string;
  onTest: () => void;
  onSave: () => void;
  onCancel: () => void;
}

function EditForm({
  name,
  setName,
  context,
  setContext,
  namespace,
  setNamespace,
  resourceType,
  setResourceType,
  resourceName,
  setResourceName,
  port,
  setPort,
  defaultPort,
  contexts,
  namespaces,
  resources,
  validationError,
  testStatus,
  testMessage,
  onTest,
  onSave,
  onCancel,
}: EditFormProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div>
        <label className={LabelClass}>{t("k8sConnections.name")}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={InputClass}
          placeholder={t("k8sConnections.namePlaceholder")}
          autoFocus
        />
      </div>

      <div>
        <label className={LabelClass}>{t("k8sConnections.context")}</label>
        <Select
          value={context || null}
          options={contexts}
          onChange={(val) => setContext(val)}
          placeholder={t("k8sConnections.chooseContext")}
          searchPlaceholder={t("common.search")}
          noResultsLabel={t("common.noResults")}
        />
      </div>

      <div>
        <label className={LabelClass}>{t("k8sConnections.namespace")}</label>
        <Select
          value={namespace || null}
          options={namespaces}
          onChange={(val) => setNamespace(val)}
          placeholder={t("k8sConnections.chooseNamespace")}
          searchPlaceholder={t("common.search")}
          noResultsLabel={t("common.noResults")}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={LabelClass}>
            {t("k8sConnections.resourceType")}
          </label>
          <Select
            value={resourceType}
            options={["service", "pod"]}
            labels={{
              service: t("k8sConnections.resourceTypeService"),
              pod: t("k8sConnections.resourceTypePod"),
            }}
            onChange={(val) => setResourceType(val)}
            searchable={false}
          />
        </div>

        <div className="flex-1">
          <label className={LabelClass}>
            {t("k8sConnections.resourceName")}
          </label>
          <Select
            value={resourceName || null}
            options={resources}
            onChange={(val) => setResourceName(val)}
            placeholder={t("k8sConnections.chooseResource")}
            searchPlaceholder={t("common.search")}
            noResultsLabel={t("common.noResults")}
          />
        </div>
      </div>

      <div>
        <label className={LabelClass}>{t("k8sConnections.port")}</label>
        <input
          type="number"
          value={port ?? ""}
          onChange={(e) =>
            setPort(e.target.value === "" ? undefined : Number(e.target.value))
          }
          className={InputClass}
          placeholder={defaultPort != null ? String(defaultPort) : undefined}
        />
      </div>

      {/* Test result */}
      {testStatus !== "idle" && (
        <div
          className={clsx(
            "text-xs px-3 py-2 rounded-md",
            testStatus === "testing" && "text-muted",
            testStatus === "success" && "text-green-400 bg-green-500/10",
            testStatus === "error" && "text-red-400 bg-red-500/10"
          )}
        >
          {testStatus === "testing" && (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              {t("k8sConnections.testing")}
            </span>
          )}
          {testStatus === "success" && (
            <span className="flex items-center gap-1.5">
              <Check size={12} />
              {testMessage}
            </span>
          )}
          {testStatus === "error" && (
            <span className="flex items-center gap-1.5">
              <XCircle size={12} />
              {testMessage}
            </span>
          )}
        </div>
      )}

      {/* Validation error */}
      {validationError && (
        <p className="text-xs text-red-400">{validationError}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onTest}
          disabled={!context || !namespace}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface-secondary hover:bg-surface-tertiary text-secondary rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testStatus === "testing" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Zap size={12} />
          )}
          {t("k8sConnections.test")}
        </button>
        <button
          onClick={onSave}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
        >
          <Check size={12} />
          {t("common.save")}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium text-muted hover:text-secondary rounded-md transition-colors"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
