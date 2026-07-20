import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  type K8sCommandOptions,
  type K8sConnection,
  type K8sConnectionInput,
} from "../../utils/k8s";
import { toErrorMessage } from "../../utils/errors";
import { useK8sPathOverrides } from "../../hooks/useK8sPathOverrides";
import { useLatestAsync } from "../../hooks/useLatestAsync";
import { Modal } from "../ui/Modal";
import { Select } from "../ui/Select";
import { K8sAdvancedSettings } from "../ui/K8sAdvancedSettings";
import clsx from "clsx";

interface K8sConnectionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPort?: number | null;
}

interface DiscoveryErrors {
  contexts: string | null;
  namespaces: string | null;
  resources: string | null;
}

type DiscoverySource = keyof DiscoveryErrors;

const InputClass =
  "w-full px-3 pt-2 pb-1 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none leading-tight";
const LabelClass = "block text-xs uppercase font-bold text-muted mb-1";

export function K8sConnectionsModal({
  isOpen,
  onClose,
  defaultPort,
}: K8sConnectionsModalProps) {
  const { t } = useTranslation();
  const { invalidate, run } = useLatestAsync();
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
  const [discoveryErrors, setDiscoveryErrors] = useState<DiscoveryErrors>({
    contexts: null,
    namespaces: null,
    resources: null,
  });

  // Status
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [pathActionError, setPathActionError] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);
  const actionSequenceRef = useRef(0);
  const activeActionRef = useRef<number | null>(null);

  const beginFormAction = useCallback((): number | null => {
    if (activeActionRef.current !== null) return null;

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

  const cancelFormAction = useCallback(() => {
    actionSequenceRef.current += 1;
    activeActionRef.current = null;
    setIsActionPending(false);
  }, []);

  const setDiscoveryError = useCallback(
    (source: DiscoverySource, error: string | null) => {
      setDiscoveryErrors((previous) =>
        previous[source] === error ? previous : { ...previous, [source]: error },
      );
    },
    [],
  );

  const invalidateFormRequests = useCallback(() => {
    invalidate("k8s-contexts");
    invalidate("k8s-namespaces");
    invalidate("k8s-resources");
    invalidate("k8s-ports");
    invalidate("k8s-test");
  }, [invalidate]);

  const invalidateConnectionTest = useCallback(() => {
    invalidate("k8s-test");
    setTestStatus("idle");
    setTestMessage("");
  }, [invalidate]);

  const loadConnections = useCallback(async () => {
    const result = await run("k8s-connections", () => loadK8sConnections());
    if (result.status === "success") {
      setConnections(result.value);
    }
  }, [run]);

  const loadContexts = useCallback(
    async (options: K8sCommandOptions) => {
      const result = await run("k8s-contexts", () => getK8sContexts(options));
      if (result.status === "success") {
        setContexts(result.value);
        setDiscoveryError("contexts", null);
      } else if (result.status === "error") {
        setContexts([]);
        setDiscoveryError("contexts", toErrorMessage(result.error));
      }
    },
    [run, setDiscoveryError],
  );

  const loadNamespaces = useCallback(
    async (selectedContext: string, options: K8sCommandOptions) => {
      const result = await run("k8s-namespaces", () =>
        getK8sNamespaces(selectedContext, options),
      );
      if (result.status === "success") {
        setNamespaces(result.value);
        setDiscoveryError("namespaces", null);
      } else if (result.status === "error") {
        setNamespaces([]);
        setDiscoveryError("namespaces", toErrorMessage(result.error));
      }
    },
    [run, setDiscoveryError],
  );

  const loadResources = useCallback(
    async (
      selectedContext: string,
      selectedNamespace: string,
      selectedResourceType: string,
      options: K8sCommandOptions,
    ) => {
      const result = await run("k8s-resources", () =>
        getK8sResources(
          selectedContext,
          selectedNamespace,
          selectedResourceType,
          options,
        ),
      );
      if (result.status === "success") {
        setResources(result.value);
        setDiscoveryError("resources", null);
      } else if (result.status === "error") {
        setResources([]);
        setDiscoveryError("resources", toErrorMessage(result.error));
      }
    },
    [run, setDiscoveryError],
  );

  const loadResourcePorts = useCallback(
    async (
      selectedContext: string,
      selectedNamespace: string,
      selectedResourceType: string,
      selectedResourceName: string,
      options: K8sCommandOptions,
    ) => {
      const result = await run("k8s-ports", () =>
        getK8sResourcePorts(
          selectedContext,
          selectedNamespace,
          selectedResourceType,
          selectedResourceName,
          options,
        ),
      );
      if (result.status === "success" && result.value.length === 1) {
        setPort((previous) =>
          previous === result.value[0] ? previous : result.value[0],
        );
      }
    },
    [run],
  );

  const handlePathsApplied = useCallback(
    (options: K8sCommandOptions) => {
      invalidateFormRequests();
      setContext("");
      setNamespace("");
      setResourceType("service");
      setResourceName("");
      setPort(undefined);
      setIsPortOverridden(false);
      setContexts([]);
      setNamespaces([]);
      setResources([]);
      setDiscoveryErrors({ contexts: null, namespaces: null, resources: null });
      setTestStatus("idle");
      setTestMessage("");
      setPathActionError(null);
      void loadContexts(options);
    },
    [invalidateFormRequests, loadContexts],
  );

  const pathOverrides = useK8sPathOverrides({
    onApplied: handlePathsApplied,
    onDraftChanged: invalidateConnectionTest,
  });
  const {
    appliedOptions,
    ensureApplied,
    cancelPending: cancelPathValidation,
    initialize: initializePathOverrides,
    reset: resetPathOverrides,
  } = pathOverrides;

  const actionSnapshot = useMemo(
    () => ({
      name,
      context,
      namespace,
      resourceType,
      resourceName,
      port,
      effectivePort,
      isPortOverridden,
      editingId,
      isCreating,
      kubectlPath: pathOverrides.kubectlPath,
      kubeconfigPath: pathOverrides.kubeconfigPath,
      appliedOptions,
    }),
    [
      appliedOptions,
      context,
      editingId,
      effectivePort,
      isCreating,
      isPortOverridden,
      name,
      namespace,
      pathOverrides.kubeconfigPath,
      pathOverrides.kubectlPath,
      port,
      resourceName,
      resourceType,
    ],
  );
  const actionSnapshotRef = useRef(actionSnapshot);
  useLayoutEffect(() => {
    actionSnapshotRef.current = actionSnapshot;
  }, [actionSnapshot]);

  useEffect(() => {
    if (!isOpen) {
      invalidate("k8s-connections");
      invalidateFormRequests();
      cancelPathValidation();
      actionSequenceRef.current += 1;
      activeActionRef.current = null;
      queueMicrotask(() => {
        setIsActionPending(false);
        setTestStatus("idle");
        setTestMessage("");
      });
      return;
    }

    void Promise.resolve().then(loadConnections);
  }, [
    cancelPathValidation,
    invalidate,
    invalidateFormRequests,
    isOpen,
    loadConnections,
  ]);

  const resetForm = useCallback(
    (options: K8sCommandOptions = {}) => {
      cancelFormAction();
      invalidateFormRequests();
      resetPathOverrides(options);
      setName("");
      setContext("");
      setNamespace("");
      setResourceType("service");
      setResourceName("");
      setPort(undefined);
      setIsPortOverridden(false);
      setContexts([]);
      setNamespaces([]);
      setResources([]);
      setDiscoveryErrors({ contexts: null, namespaces: null, resources: null });
      setTestStatus("idle");
      setTestMessage("");
      setValidationError(null);
      setPathActionError(null);
    },
    [cancelFormAction, invalidateFormRequests, resetPathOverrides],
  );

  const handleCreate = useCallback(() => {
    resetForm();
    setIsCreating(true);
    setEditingId(null);
    void loadContexts({});
  }, [loadContexts, resetForm]);

  const handleEdit = useCallback(
    (connection: K8sConnection) => {
      cancelFormAction();
      const options: K8sCommandOptions = {
        kubectl_path: connection.kubectl_path,
        kubeconfig_path: connection.kubeconfig_path,
      };
      invalidateFormRequests();
      initializePathOverrides(options);
      setName(connection.name);
      setContext(connection.context);
      setNamespace(connection.namespace);
      setResourceType(connection.resource_type);
      setResourceName(connection.resource_name);
      setPort(connection.port);
      setIsPortOverridden(true);
      setContexts([]);
      setNamespaces([]);
      setResources([]);
      setDiscoveryErrors({ contexts: null, namespaces: null, resources: null });
      setEditingId(connection.id);
      setIsCreating(false);
      setTestStatus("idle");
      setTestMessage("");
      setValidationError(null);
      setPathActionError(null);
      void loadContexts(options);
      void loadNamespaces(connection.context, options);
      void loadResources(
        connection.context,
        connection.namespace,
        connection.resource_type,
        options,
      );
    },
    [
      cancelFormAction,
      initializePathOverrides,
      invalidateFormRequests,
      loadContexts,
      loadNamespaces,
      loadResources,
    ],
  );

  const handleCancel = useCallback(() => {
    resetForm();
    setEditingId(null);
    setIsCreating(false);
  }, [resetForm]);

  const handleClose = useCallback(() => {
    handleCancel();
    onClose();
  }, [handleCancel, onClose]);

  const resetPortSelection = useCallback(() => {
    if (!isPortOverridden) setPort(undefined);
  }, [isPortOverridden]);

  const handleContextChange = useCallback(
    (value: string) => {
      invalidate("k8s-namespaces");
      invalidate("k8s-resources");
      invalidate("k8s-ports");
      invalidateConnectionTest();
      setContext(value);
      setNamespace("");
      setResourceName("");
      resetPortSelection();
      setNamespaces([]);
      setResources([]);
      setDiscoveryError("namespaces", null);
      setDiscoveryError("resources", null);
      setPathActionError(null);

      if (!value) return;
      void loadNamespaces(value, appliedOptions);
    },
    [
      appliedOptions,
      invalidate,
      invalidateConnectionTest,
      loadNamespaces,
      resetPortSelection,
      setDiscoveryError,
    ],
  );

  const handleNamespaceChange = useCallback(
    (value: string) => {
      invalidate("k8s-resources");
      invalidate("k8s-ports");
      invalidateConnectionTest();
      setNamespace(value);
      setResourceName("");
      resetPortSelection();
      setResources([]);
      setDiscoveryError("resources", null);

      if (!context || !value || !resourceType) return;
      void loadResources(context, value, resourceType, appliedOptions);
    },
    [
      appliedOptions,
      context,
      invalidate,
      invalidateConnectionTest,
      loadResources,
      resetPortSelection,
      resourceType,
      setDiscoveryError,
    ],
  );

  const handleResourceTypeChange = useCallback(
    (value: string) => {
      invalidate("k8s-resources");
      invalidate("k8s-ports");
      setResourceType(value);
      setResourceName("");
      resetPortSelection();
      setResources([]);
      setDiscoveryError("resources", null);

      if (!context || !namespace || !value) return;
      void loadResources(context, namespace, value, appliedOptions);
    },
    [
      appliedOptions,
      context,
      invalidate,
      loadResources,
      namespace,
      resetPortSelection,
      setDiscoveryError,
    ],
  );

  const handleResourceNameChange = useCallback(
    (value: string) => {
      invalidate("k8s-ports");
      setResourceName(value);
      resetPortSelection();

      if (
        !context ||
        !namespace ||
        resourceType !== "service" ||
        !value ||
        isPortOverridden
      ) {
        return;
      }

      void loadResourcePorts(
        context,
        namespace,
        resourceType,
        value,
        appliedOptions,
      );
    },
    [
      appliedOptions,
      context,
      invalidate,
      isPortOverridden,
      loadResourcePorts,
      namespace,
      resetPortSelection,
      resourceType,
    ],
  );

  const handlePortChange = useCallback(
    (value: number | undefined) => {
      invalidate("k8s-ports");
      setIsPortOverridden(value != null);
      setPort(value);

      if (
        value === undefined &&
        context &&
        namespace &&
        resourceType === "service" &&
        resourceName
      ) {
        void loadResourcePorts(
          context,
          namespace,
          resourceType,
          resourceName,
          appliedOptions,
        );
      }
    },
    [
      appliedOptions,
      context,
      invalidate,
      loadResourcePorts,
      namespace,
      resourceName,
      resourceType,
    ],
  );

  const handleSave = useCallback(async () => {
    const actionId = beginFormAction();
    if (actionId === null) return;
    const startingSnapshot = actionSnapshotRef.current;

    try {
      const paths = await ensureApplied();
      if (activeActionRef.current !== actionId) return;
      if (paths.status === "applied") {
        setPathActionError(t("k8sConnections.pathSelectionReset"));
        return;
      }
      if (actionSnapshotRef.current !== startingSnapshot) return;
      if (paths.status === "invalid") {
        setPathActionError(t("k8sConnections.pathValidationFailed"));
        return;
      }
      setPathActionError(null);

      const validation = validateK8sConnection({
        name,
        context,
        namespace,
        resource_type: resourceType,
        resource_name: resourceName,
        port: effectivePort,
        ...paths.options,
      });
      if (!validation.isValid) {
        setValidationError(t(validation.errorKey));
        return;
      }
      const input: K8sConnectionInput = validation.value;

      try {
        if (
          activeActionRef.current !== actionId ||
          actionSnapshotRef.current !== startingSnapshot
        ) {
          return;
        }
        if (isCreating) {
          await saveK8sConnection(input);
        } else if (editingId) {
          await updateK8sConnection(editingId, input);
        }
        await loadConnections();
        if (
          activeActionRef.current !== actionId ||
          actionSnapshotRef.current !== startingSnapshot
        ) {
          return;
        }
        handleCancel();
      } catch (error) {
        if (
          activeActionRef.current === actionId &&
          actionSnapshotRef.current === startingSnapshot
        ) {
          setValidationError(toErrorMessage(error));
        }
      }
    } finally {
      finishFormAction(actionId);
    }
  }, [
    beginFormAction,
    context,
    editingId,
    effectivePort,
    ensureApplied,
    finishFormAction,
    handleCancel,
    isCreating,
    loadConnections,
    name,
    namespace,
    resourceName,
    resourceType,
    t,
  ]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteK8sConnection(id);
        await loadConnections();
        if (editingId === id) handleCancel();
      } catch (error) {
        console.error("Failed to delete K8s connection:", error);
      }
    },
    [editingId, handleCancel, loadConnections],
  );

  const handleTest = useCallback(async () => {
    const actionId = beginFormAction();
    if (actionId === null) return;
    const startingSnapshot = actionSnapshotRef.current;

    try {
      const paths = await ensureApplied();
      if (activeActionRef.current !== actionId) return;
      if (paths.status === "applied") {
        setPathActionError(t("k8sConnections.pathSelectionReset"));
        return;
      }
      if (actionSnapshotRef.current !== startingSnapshot) return;
      if (paths.status === "invalid") {
        setPathActionError(t("k8sConnections.pathValidationFailed"));
        return;
      }
      setPathActionError(null);
      if (!context || !namespace) return;

      setTestStatus("testing");
      setTestMessage("");
      const result = await run("k8s-test", () =>
        testK8sConnection(context, namespace, paths.options),
      );
      if (
        activeActionRef.current !== actionId ||
        actionSnapshotRef.current !== startingSnapshot
      ) {
        if (activeActionRef.current === actionId) {
          setTestStatus("idle");
          setTestMessage("");
        }
        return;
      }
      if (result.status === "success") {
        setTestStatus("success");
        setTestMessage(result.value);
      } else if (result.status === "error") {
        setTestStatus("error");
        setTestMessage(toErrorMessage(result.error));
      }
    } finally {
      finishFormAction(actionId);
    }
  }, [
    beginFormAction,
    context,
    ensureApplied,
    finishFormAction,
    namespace,
    run,
    t,
  ]);

  const editFormProps = {
    name,
    setName,
    context,
    onContextChange: handleContextChange,
    namespace,
    onNamespaceChange: handleNamespaceChange,
    resourceType,
    onResourceTypeChange: handleResourceTypeChange,
    resourceName,
    onResourceNameChange: handleResourceNameChange,
    port: effectivePort,
    onPortChange: handlePortChange,
    defaultPort: effectiveDefaultPort,
    contexts,
    namespaces,
    resources,
    discoveryErrors,
    pathOverrides,
    validationError,
    pathActionError,
    testStatus,
    testMessage,
    isActionPending,
    onTest: handleTest,
    onSave: handleSave,
    onCancel: handleCancel,
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      overlayClassName="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm"
    >
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col overflow-hidden">
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
              onClick={handleClose}
              className="p-1.5 text-muted hover:text-primary hover:bg-surface-secondary rounded-md transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {connections.map((connection) =>
            editingId === connection.id ? (
              <div
                key={connection.id}
                className="border border-blue-500/30 rounded-lg p-4 bg-base/50 space-y-3"
              >
                <EditForm {...editFormProps} />
              </div>
            ) : (
              <div
                key={connection.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-base border border-default hover:border-strong transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-primary truncate">
                    {connection.name}
                  </div>
                  <div className="text-xs text-muted truncate">
                    {connection.context}/{connection.namespace}/
                    {connection.resource_type}/{connection.resource_name}:
                    {connection.port}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleEdit(connection)}
                    aria-label={t("common.edit")}
                    className="p-1.5 text-muted hover:text-primary hover:bg-surface-secondary rounded transition-colors"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(connection.id)}
                    aria-label={t("common.delete")}
                    className="p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ),
          )}

          {isCreating && (
            <div className="border border-blue-500/30 rounded-lg p-4 bg-base/50 space-y-3">
              <EditForm {...editFormProps} />
            </div>
          )}

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

interface EditFormProps {
  name: string;
  setName: (value: string) => void;
  context: string;
  onContextChange: (value: string) => void;
  namespace: string;
  onNamespaceChange: (value: string) => void;
  resourceType: string;
  onResourceTypeChange: (value: string) => void;
  resourceName: string;
  onResourceNameChange: (value: string) => void;
  port: number | undefined;
  onPortChange: (value: number | undefined) => void;
  defaultPort?: number;
  contexts: string[];
  namespaces: string[];
  resources: string[];
  discoveryErrors: DiscoveryErrors;
  pathOverrides: ReturnType<typeof useK8sPathOverrides>;
  validationError: string | null;
  pathActionError: string | null;
  testStatus: "idle" | "testing" | "success" | "error";
  testMessage: string;
  isActionPending: boolean;
  onTest: () => void;
  onSave: () => void;
  onCancel: () => void;
}

function EditForm({
  name,
  setName,
  context,
  onContextChange,
  namespace,
  onNamespaceChange,
  resourceType,
  onResourceTypeChange,
  resourceName,
  onResourceNameChange,
  port,
  onPortChange,
  defaultPort,
  contexts,
  namespaces,
  resources,
  discoveryErrors,
  pathOverrides,
  validationError,
  pathActionError,
  testStatus,
  testMessage,
  isActionPending,
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
          onChange={(event) => setName(event.target.value)}
          className={InputClass}
          placeholder={t("k8sConnections.namePlaceholder")}
          autoFocus
        />
      </div>

      <K8sAdvancedSettings pathOverrides={pathOverrides} />

      <div>
        <label className={LabelClass}>{t("k8sConnections.context")}</label>
        <Select
          value={context || null}
          options={contexts}
          onChange={onContextChange}
          placeholder={
            contexts.length === 0
              ? t("k8sConnections.noContexts")
              : t("k8sConnections.chooseContext")
          }
          searchPlaceholder={t("common.search")}
          noResultsLabel={t("common.noResults")}
        />
        {discoveryErrors.contexts && (
          <p role="alert" className="mt-1 text-xs text-red-400">
            {discoveryErrors.contexts}
          </p>
        )}
      </div>

      <div>
        <label className={LabelClass}>{t("k8sConnections.namespace")}</label>
        <Select
          value={namespace || null}
          options={namespaces}
          onChange={onNamespaceChange}
          placeholder={
            namespaces.length === 0
              ? t("k8sConnections.noNamespaces")
              : t("k8sConnections.chooseNamespace")
          }
          searchPlaceholder={t("common.search")}
          noResultsLabel={t("common.noResults")}
        />
        {discoveryErrors.namespaces && (
          <p role="alert" className="mt-1 text-xs text-red-400">
            {discoveryErrors.namespaces}
          </p>
        )}
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
            onChange={onResourceTypeChange}
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
            onChange={onResourceNameChange}
            placeholder={
              resources.length === 0
                ? t("k8sConnections.noResources")
                : t("k8sConnections.chooseResource")
            }
            searchPlaceholder={t("common.search")}
            noResultsLabel={t("common.noResults")}
          />
          {discoveryErrors.resources && (
            <p role="alert" className="mt-1 text-xs text-red-400">
              {discoveryErrors.resources}
            </p>
          )}
        </div>
      </div>

      <div>
        <label className={LabelClass}>{t("k8sConnections.port")}</label>
        <input
          type="number"
          value={port ?? ""}
          onChange={(event) =>
            onPortChange(
              event.target.value === "" ? undefined : Number(event.target.value),
            )
          }
          className={InputClass}
          placeholder={defaultPort != null ? String(defaultPort) : undefined}
        />
      </div>

      {testStatus !== "idle" && (
        <div
          className={clsx(
            "text-xs px-3 py-2 rounded-md",
            testStatus === "testing" && "text-muted",
            testStatus === "success" && "text-green-400 bg-green-500/10",
            testStatus === "error" && "text-red-400 bg-red-500/10",
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

      {validationError && (
        <p className="text-xs text-red-400">{validationError}</p>
      )}
      {pathActionError && (
        <p className="text-xs text-red-400">{pathActionError}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onTest}
          disabled={!context || !namespace || isActionPending}
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
          disabled={isActionPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md transition-colors"
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
