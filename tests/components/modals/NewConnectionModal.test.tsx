import { useState, type ComponentProps, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { NewConnectionModal } from "../../../src/components/modals/NewConnectionModal";

interface MockSelectProps {
  value: string | null;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  labels?: Record<string, string>;
}

const driverState = vi.hoisted(() => ({
  defaultPort: 15432 as number | null,
}));

const k8sMocks = vi.hoisted(() => ({
  loadK8sConnections: vi.fn(),
  getK8sContexts: vi.fn(),
  getK8sNamespaces: vi.fn(),
  getK8sResources: vi.fn(),
  getK8sResourcePorts: vi.fn(),
  validateK8sPath: vi.fn(),
}));

const sshMocks = vi.hoisted(() => ({
  loadSshConnections: vi.fn(),
}));

vi.mock("../../../src/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    onClose,
    children,
  }: {
    isOpen: boolean;
    onClose: () => void;
    children: ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <button type="button" aria-label="modal-close" onClick={onClose} />
        {children}
      </div>
    ) : null,
}));

vi.mock("../../../src/components/ui/Select", () => ({
  Select: ({ value, options, onChange, placeholder, labels }: MockSelectProps) => (
    <select
      aria-label={placeholder ?? "select"}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder ?? "Select option"}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {labels?.[option] ?? option}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("../../../src/hooks/useDrivers", () => ({
  useDrivers: () => ({
    drivers: [
      {
        id: "mysql",
        name: "MySQL",
        version: "1.0.0",
        default_port: driverState.defaultPort,
        is_builtin: true,
        capabilities: {
          file_based: false,
          folder_based: false,
          connection_string: true,
          supports_ssl: false,
        },
      },
    ],
    allDrivers: [],
    installedPlugins: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("../../../src/hooks/usePluginSlotRegistry", () => ({
  usePluginSlotRegistry: () => ({
    getSlotContributions: () => [],
  }),
}));

vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {},
    updateSetting: vi.fn(),
  }),
}));

vi.mock("../../../src/hooks/useConnectionCatalogue", () => ({
  useConnectionCatalogue: () => ({
    groups: [
      {
        engine: "mysql",
        displayName: "MySQL",
        primaryParadigm: "sql",
        secondaryParadigms: [],
        installed: true,
        verified: true,
        platformSupported: true,
        downloads: null,
        drivers: [
          {
            slug: "mysql",
            name: "MySQL",
            engine: "mysql",
            paradigms: ["sql"],
            verified: true,
            installed: true,
            installedVersion: "1.0.0",
            latestVersion: "1.0.0",
            isBuiltin: true,
            platformSupported: true,
            downloads: null,
            updateAvailable: false,
            icon: null,
            color: null,
          },
        ],
      },
    ],
    facets: [],
    loading: false,
    registryOffline: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("../../../src/utils/ssh", () => ({
  loadSshConnections: sshMocks.loadSshConnections,
}));

vi.mock("../../../src/utils/k8s", () => ({
  loadK8sConnections: k8sMocks.loadK8sConnections,
  getK8sContexts: k8sMocks.getK8sContexts,
  getK8sNamespaces: k8sMocks.getK8sNamespaces,
  getK8sResources: k8sMocks.getK8sResources,
  getK8sResourcePorts: k8sMocks.getK8sResourcePorts,
  validateK8sPath: k8sMocks.validateK8sPath,
}));

vi.mock("../../../src/components/modals/NewConnectionModal/AppearanceSection", () => ({
  AppearanceSection: () => null,
}));

vi.mock("../../../src/components/modals/SshConnectionsModal", () => ({
  SshConnectionsModal: () => null,
}));

vi.mock("../../../src/components/modals/K8sConnectionsModal", () => ({
  K8sConnectionsModal: () => null,
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

type InitialConnection = NonNullable<
  ComponentProps<typeof NewConnectionModal>["initialConnection"]
>;
type InitialConnectionParams = InitialConnection["params"];

function createInitialConnection(
  params: Partial<InitialConnectionParams>,
): InitialConnection {
  return {
    id: "connection-1",
    name: "Existing K8s database",
    params: {
      driver: "mysql",
      database: "database",
      ...params,
    },
  };
}

function renderModal(initialConnection?: InitialConnection) {
  return render(
    <NewConnectionModal
      isOpen={true}
      onClose={vi.fn()}
      onSave={vi.fn()}
      initialConnection={initialConnection}
    />,
  );
}

function ClosableModalHarness({
  initialConnection,
}: {
  initialConnection: InitialConnection;
}) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        reopen
      </button>
      <NewConnectionModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSave={vi.fn()}
        initialConnection={initialConnection}
      />
    </>
  );
}

function SwitchingModalHarness({
  initialConnection,
}: {
  initialConnection: InitialConnection;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [currentConnection, setCurrentConnection] = useState<
    InitialConnection | undefined
  >(initialConnection);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setCurrentConnection(undefined);
          setIsOpen(true);
        }}
      >
        open-new
      </button>
      <NewConnectionModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSave={vi.fn()}
        initialConnection={currentConnection}
      />
    </>
  );
}

// A new connection opens on the catalogue step; picking an engine is what a user
// does to reach the form.
function pickEngineFromCatalogue() {
  fireEvent.click(
    screen.getByRole("button", { name: "connectionCatalogue.connectTo" }),
  );
}

async function openInlineK8s() {
  const view = renderModal();
  pickEngineFromCatalogue();
  fireEvent.click(screen.getByText("Kubernetes"));
  fireEvent.click(screen.getByLabelText("newConnection.useK8s"));
  fireEvent.click(screen.getByText("newConnection.createInlineK8s"));

  await waitFor(() => {
    expect(screen.getByRole("option", { name: "ctx" })).toBeInTheDocument();
  });
  return view;
}

function openAdvancedSettings(): HTMLInputElement {
  fireEvent.click(screen.getByText("k8sConnections.advancedSettings"));
  return screen.getByLabelText("k8sConnections.kubectlPath") as HTMLInputElement;
}

function fillSaveFields() {
  fireEvent.change(screen.getByPlaceholderText("newConnection.namePlaceholder"), {
    target: { value: "K8s database" },
  });
  fireEvent.click(screen.getByText("newConnection.general"));
  fireEvent.change(screen.getByPlaceholderText("newConnection.dbNamePlaceholder"), {
    target: { value: "database" },
  });
  fireEvent.click(screen.getByText("Kubernetes"));
}

async function chooseServiceResource() {
  fireEvent.change(screen.getByLabelText("newConnection.chooseContext"), {
    target: { value: "ctx" },
  });

  await waitFor(() => {
    expect(screen.getByRole("option", { name: "db" })).toBeInTheDocument();
  });
  fireEvent.change(screen.getByLabelText("newConnection.chooseNamespace"), {
    target: { value: "db" },
  });

  fireEvent.change(screen.getByLabelText("newConnection.k8sSelectType"), {
    target: { value: "service" },
  });

  await waitFor(() => {
    expect(screen.getByRole("option", { name: "mysql-svc" })).toBeInTheDocument();
  });
  fireEvent.change(screen.getByLabelText("newConnection.chooseResource"), {
    target: { value: "mysql-svc" },
  });
}

describe("NewConnectionModal K8s port defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driverState.defaultPort = 15432;
    vi.mocked(invoke).mockResolvedValue("ok");
    sshMocks.loadSshConnections.mockResolvedValue([]);
    k8sMocks.loadK8sConnections.mockResolvedValue([]);
    k8sMocks.getK8sContexts.mockResolvedValue(["ctx"]);
    k8sMocks.getK8sNamespaces.mockResolvedValue(["db"]);
    k8sMocks.getK8sResources.mockResolvedValue(["mysql-svc"]);
    k8sMocks.getK8sResourcePorts.mockResolvedValue([6543]);
    k8sMocks.validateK8sPath.mockResolvedValue(undefined);
  });

  it("uses the active driver default as the effective inline K8s port", async () => {
    k8sMocks.getK8sResourcePorts.mockResolvedValue([]);
    await openInlineK8s();
    await chooseServiceResource();

    const portInput = screen.getByPlaceholderText("15432");
    expect(portInput).toHaveAttribute("type", "number");
    expect(portInput).toHaveValue(15432);

    fireEvent.click(screen.getByText("newConnection.testConnection"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "test_connection",
        expect.objectContaining({
          request: expect.objectContaining({
            params: expect.objectContaining({
              k8s_enabled: true,
              k8s_port: 15432,
            }),
          }),
        }),
      );
    });
  });

  it("clearing a manual K8s port re-enables single-port auto-prefill", async () => {
    await openInlineK8s();

    const portInput = screen.getByPlaceholderText("15432");
    fireEvent.change(portInput, { target: { value: "9999" } });
    await chooseServiceResource();

    expect(k8sMocks.getK8sResourcePorts).not.toHaveBeenCalled();
    expect(portInput).toHaveValue(9999);

    fireEvent.change(portInput, { target: { value: "" } });

    await waitFor(() => {
      expect(k8sMocks.getK8sResourcePorts).toHaveBeenCalledWith(
        "ctx",
        "db",
        "service",
        "mysql-svc",
      );
      expect(portInput).toHaveValue(6543);
    });

    fireEvent.click(screen.getByText("newConnection.testConnection"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "test_connection",
        expect.objectContaining({
          request: expect.objectContaining({
            params: expect.objectContaining({
              k8s_port: 6543,
            }),
          }),
        }),
      );
    });
  });
});

describe("NewConnectionModal advanced inline K8s paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driverState.defaultPort = 15432;
    vi.mocked(invoke).mockResolvedValue("ok");
    sshMocks.loadSshConnections.mockResolvedValue([]);
    k8sMocks.loadK8sConnections.mockResolvedValue([]);
    k8sMocks.getK8sContexts.mockResolvedValue(["ctx"]);
    k8sMocks.getK8sNamespaces.mockResolvedValue(["db"]);
    k8sMocks.getK8sResources.mockResolvedValue(["mysql-svc"]);
    k8sMocks.getK8sResourcePorts.mockResolvedValue([6543]);
    k8sMocks.validateK8sPath.mockResolvedValue(undefined);
  });

  it("fetches inline contexts once instead of eagerly loading them", async () => {
    await openInlineK8s();

    expect(k8sMocks.getK8sContexts).toHaveBeenCalledTimes(1);
  });

  it("suppresses stale namespace and resource results", async () => {
    const firstNamespaces = createDeferred<string[]>();
    const secondNamespaces = createDeferred<string[]>();
    k8sMocks.getK8sContexts.mockResolvedValue(["ctx-a", "ctx-b"]);
    k8sMocks.getK8sNamespaces.mockImplementation((context: string) =>
      context === "ctx-a" ? firstNamespaces.promise : secondNamespaces.promise,
    );
    renderModal();
    pickEngineFromCatalogue();
    fireEvent.click(screen.getByText("Kubernetes"));
    fireEvent.click(screen.getByLabelText("newConnection.useK8s"));
    fireEvent.click(screen.getByText("newConnection.createInlineK8s"));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "ctx-a" })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("newConnection.k8sSelectType"), {
      target: { value: "service" },
    });
    fireEvent.change(screen.getByLabelText("newConnection.chooseContext"), {
      target: { value: "ctx-a" },
    });
    fireEvent.change(screen.getByLabelText("newConnection.chooseContext"), {
      target: { value: "ctx-b" },
    });

    await act(async () => {
      secondNamespaces.resolve(["namespace-a", "namespace-b"]);
    });
    await act(async () => {
      firstNamespaces.resolve(["old-namespace"]);
    });

    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: "namespace-b" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("option", { name: "old-namespace" }),
    ).not.toBeInTheDocument();

    const firstResources = createDeferred<string[]>();
    const secondResources = createDeferred<string[]>();
    k8sMocks.getK8sResources.mockImplementation(
      (_context: string, namespace: string) =>
        namespace === "namespace-a"
          ? firstResources.promise
          : secondResources.promise,
    );
    fireEvent.change(screen.getByLabelText("newConnection.chooseNamespace"), {
      target: { value: "namespace-a" },
    });
    fireEvent.change(screen.getByLabelText("newConnection.chooseNamespace"), {
      target: { value: "namespace-b" },
    });

    await act(async () => {
      secondResources.resolve(["resource-b"]);
    });
    await act(async () => {
      firstResources.resolve(["resource-a"]);
    });

    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: "resource-b" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("option", { name: "resource-a" }),
    ).not.toBeInTheDocument();
  });

  it("suppresses an inline test result after its selection is invalidated", async () => {
    const testResult = createDeferred<string>();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "test_connection" ? testResult.promise : Promise.resolve("ok"),
    );
    await openInlineK8s();
    await chooseServiceResource();

    fireEvent.click(screen.getByText("newConnection.testConnection"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "test_connection",
        expect.anything(),
      );
    });
    fireEvent.change(screen.getByLabelText("newConnection.chooseContext"), {
      target: { value: "" },
    });
    await act(async () => {
      testResult.resolve("obsolete success");
    });

    expect(screen.queryByText("obsolete success")).not.toBeInTheDocument();
  });

  it("suppresses an inline test result after the connection name changes", async () => {
    const testResult = createDeferred<string>();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "test_connection" ? testResult.promise : Promise.resolve("ok"),
    );
    await openInlineK8s();
    await chooseServiceResource();

    fireEvent.click(screen.getByText("newConnection.testConnection"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "test_connection",
        expect.anything(),
      );
    });
    fireEvent.change(screen.getByPlaceholderText("newConnection.namePlaceholder"), {
      target: { value: "Changed while testing" },
    });
    await act(async () => {
      testResult.resolve("obsolete success");
    });

    expect(screen.queryByText("obsolete success")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("newConnection.testConnection")).not.toBeDisabled();
    });
  });

  it("suppresses an inline test result after an unblurred path edit", async () => {
    const testResult = createDeferred<string>();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "test_connection" ? testResult.promise : Promise.resolve("ok"),
    );
    await openInlineK8s();
    await chooseServiceResource();

    fireEvent.click(screen.getByText("newConnection.testConnection"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "test_connection",
        expect.anything(),
      );
    });
    const kubectlInput = openAdvancedSettings();
    fireEvent.change(kubectlInput, { target: { value: "/new/kubectl" } });
    await act(async () => {
      testResult.resolve("obsolete success");
    });

    expect(screen.queryByText("obsolete success")).not.toBeInTheDocument();
  });

  it("cancels pending path validation when closed before reopening", async () => {
    const validation = createDeferred<void>();
    const reopenedCredentials = createDeferred<unknown>();
    let credentialRequests = 0;
    k8sMocks.validateK8sPath.mockReturnValue(validation.promise);
    vi.mocked(invoke).mockImplementation((command) => {
      if (command !== "get_connection_by_id") return Promise.resolve("ok");
      credentialRequests += 1;
      return credentialRequests === 1
        ? Promise.reject(new Error("use initial params"))
        : reopenedCredentials.promise;
    });
    const initialConnection = createInitialConnection({
      k8s_enabled: true,
      k8s_context: "ctx",
      k8s_namespace: "db",
      k8s_resource_type: "service",
      k8s_resource_name: "mysql-svc",
      k8s_port: 6543,
    });
    render(<ClosableModalHarness initialConnection={initialConnection} />);

    fireEvent.click(screen.getByText("Kubernetes"));
    await waitFor(() => {
      expect(screen.getByLabelText("newConnection.useK8s")).toBeChecked();
    });
    const kubectlInput = openAdvancedSettings();
    fireEvent.change(kubectlInput, { target: { value: "/late/kubectl" } });
    fireEvent.blur(kubectlInput);
    fireEvent.click(screen.getByLabelText("modal-close"));

    await act(async () => {
      validation.resolve();
    });
    fireEvent.click(screen.getByText("reopen"));
    fireEvent.click(screen.getByText("Kubernetes"));
    const reopenedKubectlInput = openAdvancedSettings();
    expect(reopenedKubectlInput).toHaveValue("");
    expect(k8sMocks.getK8sContexts).not.toHaveBeenCalledWith(
      expect.objectContaining({ kubectl_path: "/late/kubectl" }),
    );

    await act(async () => {
      reopenedCredentials.reject(new Error("finish reopening"));
    });
  });

  it("does not let a closed edit initialization overwrite a new form", async () => {
    const credentials = createDeferred<InitialConnection>();
    const initialConnection = createInitialConnection({
      k8s_enabled: true,
      k8s_context: "ctx",
      k8s_namespace: "db",
      k8s_resource_type: "service",
      k8s_resource_name: "mysql-svc",
      k8s_port: 6543,
    });
    vi.mocked(invoke).mockImplementation((command) =>
      command === "get_connection_by_id"
        ? credentials.promise
        : Promise.resolve("ok"),
    );
    render(<SwitchingModalHarness initialConnection={initialConnection} />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_connection_by_id", {
        id: initialConnection.id,
      });
    });
    fireEvent.click(screen.getByLabelText("modal-close"));
    fireEvent.click(screen.getByText("open-new"));
    pickEngineFromCatalogue();
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("newConnection.namePlaceholder"),
      ).toHaveValue("");
    });

    await act(async () => {
      credentials.resolve(
        createInitialConnection({
          k8s_enabled: true,
          k8s_context: "ctx",
          k8s_namespace: "db",
          k8s_resource_type: "service",
          k8s_resource_name: "mysql-svc",
          k8s_port: 6543,
          k8s_kubectl_path: "/stale/kubectl",
        }),
      );
    });
    fireEvent.click(screen.getByText("Kubernetes"));

    expect(screen.getByLabelText("newConnection.useK8s")).not.toBeChecked();
  });

  it("suppresses a saved K8s test result after switching connections", async () => {
    const testResult = createDeferred<string>();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "test_connection" ? testResult.promise : Promise.resolve("ok"),
    );
    k8sMocks.loadK8sConnections.mockResolvedValue([
      {
        id: "saved-a",
        name: "Cluster A",
        context: "ctx-a",
        namespace: "db-a",
        resource_type: "service",
        resource_name: "mysql-a",
        port: 3306,
      },
      {
        id: "saved-b",
        name: "Cluster B",
        context: "ctx-b",
        namespace: "db-b",
        resource_type: "service",
        resource_name: "mysql-b",
        port: 3306,
      },
    ]);
    renderModal();
    pickEngineFromCatalogue();
    fireEvent.click(screen.getByText("Kubernetes"));
    fireEvent.click(screen.getByLabelText("newConnection.useK8s"));

    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: /Cluster A/ }),
      ).toBeInTheDocument();
    });
    const savedConnectionSelect = screen.getByLabelText(
      "newConnection.chooseK8s",
    );
    fireEvent.change(savedConnectionSelect, {
      target: { value: "saved-a" },
    });
    fireEvent.click(screen.getByText("newConnection.testConnection"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "test_connection",
        expect.anything(),
      );
    });

    fireEvent.change(savedConnectionSelect, {
      target: { value: "saved-b" },
    });
    await act(async () => {
      testResult.resolve("obsolete success");
    });

    expect(screen.queryByText("obsolete success")).not.toBeInTheDocument();
  });

  it("blocks Test and Save when an inline advanced path is invalid", async () => {
    k8sMocks.validateK8sPath.mockRejectedValue(new Error("invalid kubectl"));
    await openInlineK8s();

    const kubectlInput = openAdvancedSettings();
    fireEvent.change(kubectlInput, { target: { value: "/bad/kubectl" } });
    fireEvent.blur(kubectlInput);

    await waitFor(() => {
      expect(screen.getByText("invalid kubectl")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("newConnection.testConnection"));
    await waitFor(() => {
      expect(
        screen.getByText("k8sConnections.pathValidationFailed"),
      ).toBeInTheDocument();
    });
    expect(invoke).not.toHaveBeenCalledWith("test_connection", expect.anything());

    fireEvent.click(screen.getByText("newConnection.save"));
    await waitFor(() => {
      expect(invoke).not.toHaveBeenCalledWith("save_connection", expect.anything());
    });
  });

  it.each([
    {
      actionLabel: "newConnection.testConnection",
      command: "test_connection",
    },
    { actionLabel: "newConnection.save", command: "update_connection" },
  ] as const)(
    "aborts $actionLabel when inline selections change during path preflight",
    async ({ actionLabel, command }) => {
      const validation = createDeferred<void>();
      k8sMocks.validateK8sPath.mockReturnValue(validation.promise);
      k8sMocks.getK8sContexts.mockResolvedValue(["ctx", "ctx-next"]);
      vi.mocked(invoke).mockImplementation((invokedCommand) =>
        invokedCommand === "get_connection_by_id"
          ? Promise.reject(new Error("use initial params"))
          : Promise.resolve("ok"),
      );
      renderModal(
        createInitialConnection({
          k8s_enabled: true,
          k8s_context: "ctx",
          k8s_namespace: "db",
          k8s_resource_type: "service",
          k8s_resource_name: "mysql-svc",
          k8s_port: 6543,
          k8s_kubectl_path: "/opt/kubectl",
        }),
      );

      fireEvent.click(screen.getByText("Kubernetes"));
      await waitFor(() => {
        expect(screen.getByRole("option", { name: "ctx-next" })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText(actionLabel));
      await waitFor(() => {
        expect(k8sMocks.validateK8sPath).toHaveBeenCalledWith(
          "/opt/kubectl",
          "kubectl",
        );
      });
      expect(screen.getByText("newConnection.testConnection")).toBeDisabled();
      expect(screen.getByText("newConnection.save")).toBeDisabled();

      fireEvent.change(screen.getByLabelText("newConnection.chooseContext"), {
        target: { value: "ctx-next" },
      });
      await act(async () => {
        validation.resolve();
      });

      await waitFor(() => {
        expect(screen.getByText(actionLabel)).not.toBeDisabled();
      });
      expect(invoke).not.toHaveBeenCalledWith(command, expect.anything());
    },
  );

  it("applies paths once, resets inline selections and propagates overrides", async () => {
    await openInlineK8s();
    await chooseServiceResource();
    const portInput = screen.getByPlaceholderText("15432");
    fireEvent.change(portInput, { target: { value: "9999" } });

    const kubectlInput = openAdvancedSettings();
    fireEvent.change(kubectlInput, { target: { value: " /opt/kubectl " } });
    fireEvent.blur(kubectlInput);

    await waitFor(() => {
      expect(k8sMocks.getK8sContexts).toHaveBeenLastCalledWith(
        expect.objectContaining({ kubectl_path: "/opt/kubectl" }),
      );
    });
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(selects[0]).toHaveValue("");
    expect(selects[1]).toHaveValue("");
    expect(selects[2]).toHaveValue("");
    expect(selects[3]).toHaveValue("");
    expect(portInput).toHaveValue(15432);

    await chooseServiceResource();
    fireEvent.click(screen.getByText("newConnection.testConnection"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "test_connection",
        expect.objectContaining({
          request: expect.objectContaining({
            params: expect.objectContaining({
              k8s_kubectl_path: "/opt/kubectl",
            }),
          }),
        }),
      );
    });

    fillSaveFields();
    fireEvent.click(screen.getByText("newConnection.save"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "save_connection",
        expect.objectContaining({
          params: expect.objectContaining({
            k8s_kubectl_path: "/opt/kubectl",
          }),
        }),
      );
    });
  });

  it("blocks a submission that applies paths until inline selections are remade", async () => {
    await openInlineK8s();
    await chooseServiceResource();
    const kubectlInput = openAdvancedSettings();
    fireEvent.change(kubectlInput, { target: { value: "/opt/kubectl" } });

    fireEvent.click(screen.getByText("newConnection.testConnection"));
    await waitFor(() => {
      expect(
        screen.getByText("k8sConnections.pathSelectionReset"),
      ).toBeInTheDocument();
    });
    expect(invoke).not.toHaveBeenCalledWith("test_connection", expect.anything());

    fireEvent.click(screen.getByText("newConnection.testConnection"));
    await waitFor(() => {
      expect(
        screen.getByText("k8sConnections.errors.contextRequired"),
      ).toBeInTheDocument();
    });
    expect(invoke).not.toHaveBeenCalledWith("test_connection", expect.anything());
  });

  it("blocks Save after blur-applied paths until selections are remade", async () => {
    await openInlineK8s();
    await chooseServiceResource();
    const kubectlInput = openAdvancedSettings();
    fireEvent.change(kubectlInput, { target: { value: "/opt/kubectl" } });
    fireEvent.blur(kubectlInput);

    await waitFor(() => {
      expect(k8sMocks.getK8sContexts).toHaveBeenLastCalledWith(
        expect.objectContaining({ kubectl_path: "/opt/kubectl" }),
      );
    });
    fillSaveFields();
    fireEvent.click(screen.getByText("newConnection.save"));

    await waitFor(() => {
      expect(
        screen.getByText("k8sConnections.errors.contextRequired"),
      ).toBeInTheDocument();
    });
    expect(invoke).not.toHaveBeenCalledWith("save_connection", expect.anything());
  });

  it("preserves applied inline paths when Kubernetes is disabled and reopened", async () => {
    const view = await openInlineK8s();
    const kubectlInput = openAdvancedSettings();
    fireEvent.change(kubectlInput, { target: { value: "/opt/kubectl" } });
    fireEvent.blur(kubectlInput);

    await waitFor(() => {
      expect(k8sMocks.getK8sContexts).toHaveBeenLastCalledWith(
        expect.objectContaining({ kubectl_path: "/opt/kubectl" }),
      );
    });
    fireEvent.click(screen.getByLabelText("newConnection.useK8s"));
    fillSaveFields();
    fireEvent.click(screen.getByText("newConnection.save"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "save_connection",
        expect.objectContaining({
          params: expect.objectContaining({
            k8s_enabled: false,
            k8s_kubectl_path: "/opt/kubectl",
          }),
        }),
      );
    });

    view.unmount();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "get_connection_by_id"
        ? Promise.reject(new Error("use initial params"))
        : Promise.resolve("ok"),
    );
    k8sMocks.loadK8sConnections.mockClear();
    renderModal(
      createInitialConnection({
        k8s_enabled: false,
        k8s_kubectl_path: "/opt/kubectl",
      }),
    );
    await waitFor(() => {
      expect(k8sMocks.loadK8sConnections).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText("Kubernetes"));
    fireEvent.click(screen.getByLabelText("newConnection.useK8s"));
    const reopenedKubectlInput = openAdvancedSettings();
    expect(reopenedKubectlInput).toHaveValue("/opt/kubectl");
  });

  it("locks the current session until persistence completes", async () => {
    const save = createDeferred<{ id: string }>();
    const onClose = vi.fn();
    const onSave = vi.fn();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "save_connection" ? save.promise : Promise.resolve("ok"),
    );
    render(
      <NewConnectionModal
        isOpen={true}
        onClose={onClose}
        onSave={onSave}
      />,
    );
    pickEngineFromCatalogue();
    fillSaveFields();

    fireEvent.click(screen.getByText("newConnection.save"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "save_connection",
        expect.anything(),
      );
    });
    expect(
      screen.getByPlaceholderText("newConnection.namePlaceholder"),
    ).toBeDisabled();
    fireEvent.click(screen.getByLabelText("modal-close"));
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve({ id: "saved-connection" });
    });
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("does not clear an unrelated name validation error after a valid path blur", async () => {
    await openInlineK8s();

    fireEvent.click(screen.getByText("newConnection.save"));
    await waitFor(() => {
      expect(screen.getByText("newConnection.nameRequired")).toBeInTheDocument();
    });

    const kubectlInput = openAdvancedSettings();
    fireEvent.change(kubectlInput, { target: { value: "/opt/kubectl" } });
    fireEvent.blur(kubectlInput);

    await waitFor(() => {
      expect(k8sMocks.validateK8sPath).toHaveBeenCalledWith(
        "/opt/kubectl",
        "kubectl",
      );
    });
    expect(screen.getByText("newConnection.nameRequired")).toBeInTheDocument();
  });

  it("restores and updates persisted inline path overrides", async () => {
    vi.mocked(invoke).mockImplementation((command) =>
      command === "get_connection_by_id"
        ? Promise.reject(new Error("use initial params"))
        : Promise.resolve("ok"),
    );
    renderModal(
      createInitialConnection({
        k8s_enabled: true,
        k8s_context: "ctx",
        k8s_namespace: "db",
        k8s_resource_type: "service",
        k8s_resource_name: "mysql-svc",
        k8s_port: 6543,
        k8s_kubectl_path: "/opt/kubectl",
        k8s_kubeconfig_path: "/tmp/kubeconfig",
      }),
    );

    fireEvent.click(screen.getByText("Kubernetes"));
    await waitFor(() => {
      expect(screen.getByLabelText("newConnection.useK8s")).toBeChecked();
    });
    const kubectlInput = openAdvancedSettings();
    expect(kubectlInput).toHaveValue("/opt/kubectl");
    expect(screen.getByLabelText("k8sConnections.kubeconfigPath")).toHaveValue(
      "/tmp/kubeconfig",
    );

    fireEvent.click(screen.getByText("newConnection.save"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "update_connection",
        expect.objectContaining({
          params: expect.objectContaining({
            k8s_kubectl_path: "/opt/kubectl",
            k8s_kubeconfig_path: "/tmp/kubeconfig",
          }),
        }),
      );
    });
  });

  it("keeps saved K8s mode free of inline path overrides", async () => {
    vi.mocked(invoke).mockImplementation((command) =>
      command === "get_connection_by_id"
        ? Promise.reject(new Error("use initial params"))
        : Promise.resolve("ok"),
    );
    k8sMocks.loadK8sConnections.mockResolvedValue([
      {
        id: "saved-k8s",
        name: "Saved cluster",
        context: "ctx",
        namespace: "db",
        resource_type: "service",
        resource_name: "mysql-svc",
        port: 6543,
        kubectl_path: "/saved/kubectl",
        kubeconfig_path: "/saved/kubeconfig",
      },
    ]);
    renderModal(
      createInitialConnection({
        k8s_enabled: true,
        k8s_connection_id: "saved-k8s",
        k8s_kubectl_path: "/stale/inline-kubectl",
        k8s_kubeconfig_path: "/stale/inline-kubeconfig",
      }),
    );

    fireEvent.click(screen.getByText("Kubernetes"));
    await waitFor(() => {
      expect(screen.getByLabelText("newConnection.useK8s")).toBeChecked();
    });
    fireEvent.click(screen.getByText("newConnection.save"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "update_connection",
        expect.anything(),
      );
    });

    const updateCall = vi
      .mocked(invoke)
      .mock.calls.find(([command]) => command === "update_connection");
    const payload = updateCall?.[1] as
      | { params: Record<string, unknown> }
      | undefined;
    expect(payload?.params).toMatchObject({
      k8s_enabled: true,
      k8s_connection_id: "saved-k8s",
    });
    expect(payload?.params).not.toHaveProperty("k8s_kubectl_path");
    expect(payload?.params).not.toHaveProperty("k8s_kubeconfig_path");
    expect(k8sMocks.getK8sContexts).not.toHaveBeenCalled();
  });
});
