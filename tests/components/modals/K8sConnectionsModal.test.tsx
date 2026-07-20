import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { K8sConnectionsModal } from "../../../src/components/modals/K8sConnectionsModal";

interface MockSelectProps {
  value: string | null;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  labels?: Record<string, string>;
}

interface K8sValidationInput {
  name?: string;
  context?: string;
  namespace?: string;
  resource_type?: string;
  resource_name?: string;
  port?: number;
  kubectl_path?: string;
  kubeconfig_path?: string;
}

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

const k8sMocks = vi.hoisted(() => ({
  loadK8sConnections: vi.fn(),
  saveK8sConnection: vi.fn(),
  updateK8sConnection: vi.fn(),
  deleteK8sConnection: vi.fn(),
  testK8sConnection: vi.fn(),
  getK8sContexts: vi.fn(),
  getK8sNamespaces: vi.fn(),
  getK8sResources: vi.fn(),
  getK8sResourcePorts: vi.fn(),
  validateK8sPath: vi.fn(),
  validateK8sConnection: vi.fn(),
}));

vi.mock("../../../src/components/ui/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
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

vi.mock("../../../src/utils/k8s", () => ({
  loadK8sConnections: k8sMocks.loadK8sConnections,
  saveK8sConnection: k8sMocks.saveK8sConnection,
  updateK8sConnection: k8sMocks.updateK8sConnection,
  deleteK8sConnection: k8sMocks.deleteK8sConnection,
  testK8sConnection: k8sMocks.testK8sConnection,
  getK8sContexts: k8sMocks.getK8sContexts,
  getK8sNamespaces: k8sMocks.getK8sNamespaces,
  getK8sResources: k8sMocks.getK8sResources,
  getK8sResourcePorts: k8sMocks.getK8sResourcePorts,
  validateK8sPath: k8sMocks.validateK8sPath,
  validateK8sConnection: k8sMocks.validateK8sConnection,
}));

function openAdvancedSettings(): HTMLInputElement {
  fireEvent.click(screen.getByText("k8sConnections.advancedSettings"));
  return screen.getByLabelText("k8sConnections.kubectlPath") as HTMLInputElement;
}

function renderModal(defaultPort: number | null) {
  return render(
    <K8sConnectionsModal
      isOpen={true}
      onClose={vi.fn()}
      defaultPort={defaultPort}
    />,
  );
}

async function fillRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText("k8sConnections.namePlaceholder"), {
    target: { value: "cluster" },
  });
  await waitFor(() => {
    expect(screen.getByRole("option", { name: "ctx" })).toBeInTheDocument();
  });
  fireEvent.change(screen.getByLabelText("k8sConnections.chooseContext"), {
    target: { value: "ctx" },
  });

  await waitFor(() => {
    expect(screen.getByRole("option", { name: "db" })).toBeInTheDocument();
  });
  fireEvent.change(screen.getByLabelText("k8sConnections.chooseNamespace"), {
    target: { value: "db" },
  });

  await waitFor(() => {
    expect(screen.getByRole("option", { name: "mysql-svc" })).toBeInTheDocument();
  });
  fireEvent.change(screen.getByLabelText("k8sConnections.chooseResource"), {
    target: { value: "mysql-svc" },
  });
}

describe("K8sConnectionsModal port defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    k8sMocks.loadK8sConnections.mockResolvedValue([]);
    k8sMocks.saveK8sConnection.mockResolvedValue({ id: "new" });
    k8sMocks.updateK8sConnection.mockResolvedValue({ id: "existing" });
    k8sMocks.deleteK8sConnection.mockResolvedValue(undefined);
    k8sMocks.testK8sConnection.mockResolvedValue("ok");
    k8sMocks.getK8sContexts.mockResolvedValue(["ctx"]);
    k8sMocks.getK8sNamespaces.mockResolvedValue(["db"]);
    k8sMocks.getK8sResources.mockResolvedValue(["mysql-svc"]);
    k8sMocks.getK8sResourcePorts.mockResolvedValue([]);
    k8sMocks.validateK8sPath.mockResolvedValue(undefined);
    k8sMocks.validateK8sConnection.mockImplementation(
      (input: K8sValidationInput) =>
        input.port != null && input.port >= 1 && input.port <= 65535
          ? {
              isValid: true,
              value: {
                name: input.name ?? "",
                context: input.context ?? "",
                namespace: input.namespace ?? "",
                resource_type: input.resource_type ?? "service",
                resource_name: input.resource_name ?? "",
                port: input.port,
                kubectl_path: input.kubectl_path,
                kubeconfig_path: input.kubeconfig_path,
              },
            }
          : { isValid: false, errorKey: "k8sConnections.errors.portInvalid" },
    );
  });

  it("does not fall back to MySQL port when the driver has no default port", () => {
    renderModal(null);

    fireEvent.click(screen.getByText("k8sConnections.add"));

    const portInput = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(portInput.value).toBe("");
    expect(portInput).not.toHaveAttribute("placeholder", "3306");
  });

  it("tracks the current driver default port while the field is not overridden", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <K8sConnectionsModal isOpen={true} onClose={onClose} defaultPort={3306} />,
    );

    fireEvent.click(screen.getByText("k8sConnections.add"));
    const portInput = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(portInput.value).toBe("3306");

    rerender(
      <K8sConnectionsModal isOpen={true} onClose={onClose} defaultPort={5432} />,
    );
    expect(portInput.value).toBe("5432");
  });

  it("clearing a manual port falls back to the provided driver default instead of 0", async () => {
    renderModal(15432);

    fireEvent.click(screen.getByText("k8sConnections.add"));
    await fillRequiredFields();

    const portInput = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(portInput.value).toBe("15432");

    fireEvent.change(portInput, { target: { value: "7777" } });
    fireEvent.change(portInput, { target: { value: "" } });
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() => {
      expect(k8sMocks.saveK8sConnection).toHaveBeenCalledWith(
        expect.objectContaining({ port: 15432 }),
      );
    });
  });

  it("restarts single-port discovery after clearing a manual port", async () => {
    k8sMocks.getK8sResourcePorts.mockResolvedValue([6543]);
    renderModal(15432);

    fireEvent.click(screen.getByText("k8sConnections.add"));
    await fillRequiredFields();

    const portInput = screen.getByRole("spinbutton") as HTMLInputElement;
    await waitFor(() => {
      expect(portInput).toHaveValue(6543);
    });

    fireEvent.change(portInput, { target: { value: "7777" } });
    fireEvent.change(portInput, { target: { value: "" } });

    await waitFor(() => {
      expect(k8sMocks.getK8sResourcePorts).toHaveBeenCalledTimes(2);
      expect(portInput).toHaveValue(6543);
    });
  });

  it("does not let late auto-discovery overwrite a manual port", async () => {
    const ports = createDeferred<number[]>();
    k8sMocks.getK8sResourcePorts.mockReturnValue(ports.promise);
    renderModal(15432);

    fireEvent.click(screen.getByText("k8sConnections.add"));
    await fillRequiredFields();
    await waitFor(() => {
      expect(k8sMocks.getK8sResourcePorts).toHaveBeenCalled();
    });

    const portInput = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(portInput, { target: { value: "7777" } });
    await act(async () => {
      ports.resolve([6543]);
    });

    expect(portInput).toHaveValue(7777);
  });
});

describe("K8sConnectionsModal advanced paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    k8sMocks.loadK8sConnections.mockResolvedValue([]);
    k8sMocks.saveK8sConnection.mockResolvedValue({ id: "new" });
    k8sMocks.updateK8sConnection.mockResolvedValue({ id: "existing" });
    k8sMocks.deleteK8sConnection.mockResolvedValue(undefined);
    k8sMocks.testK8sConnection.mockResolvedValue("ok");
    k8sMocks.getK8sContexts.mockResolvedValue(["ctx"]);
    k8sMocks.getK8sNamespaces.mockResolvedValue(["db"]);
    k8sMocks.getK8sResources.mockResolvedValue(["mysql-svc"]);
    k8sMocks.getK8sResourcePorts.mockResolvedValue([]);
    k8sMocks.validateK8sPath.mockResolvedValue(undefined);
    k8sMocks.validateK8sConnection.mockImplementation(
      (input: K8sValidationInput) => ({
        isValid: true,
        value: {
          name: input.name ?? "",
          context: input.context ?? "",
          namespace: input.namespace ?? "",
          resource_type: input.resource_type ?? "service",
          resource_name: input.resource_name ?? "",
          port: input.port ?? 15432,
          kubectl_path: input.kubectl_path,
          kubeconfig_path: input.kubeconfig_path,
        },
      }),
    );
  });

  it("hydrates saved edit discovery and retains its path overrides", async () => {
    k8sMocks.loadK8sConnections.mockResolvedValue([
      {
        id: "saved",
        name: "Saved cluster",
        context: "ctx",
        namespace: "db",
        resource_type: "service",
        resource_name: "mysql-svc",
        port: 6543,
        kubectl_path: "/opt/kubectl",
        kubeconfig_path: "/tmp/kubeconfig",
      },
    ]);
    renderModal(15432);

    await waitFor(() => {
      expect(screen.getByText("Saved cluster")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("common.edit"));

    await waitFor(() => {
      expect(k8sMocks.getK8sNamespaces).toHaveBeenCalledWith(
        "ctx",
        expect.objectContaining({ kubectl_path: "/opt/kubectl" }),
      );
      expect(k8sMocks.getK8sResources).toHaveBeenCalledWith(
        "ctx",
        "db",
        "service",
        expect.objectContaining({ kubeconfig_path: "/tmp/kubeconfig" }),
      );
      expect(screen.getByRole("option", { name: "db" })).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "mysql-svc" }),
      ).toBeInTheDocument();
    });

    const kubectlInput = openAdvancedSettings();
    expect(kubectlInput).toHaveValue("/opt/kubectl");
    expect(screen.getByLabelText("k8sConnections.kubeconfigPath")).toHaveValue(
      "/tmp/kubeconfig",
    );

    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => {
      expect(k8sMocks.updateK8sConnection).toHaveBeenCalledWith(
        "saved",
        expect.objectContaining({
          kubectl_path: "/opt/kubectl",
          kubeconfig_path: "/tmp/kubeconfig",
        }),
      );
    });
  });

  it("does not apply an edited path while a persisted sibling is invalid", async () => {
    k8sMocks.loadK8sConnections.mockResolvedValue([
      {
        id: "saved",
        name: "Saved cluster",
        context: "ctx",
        namespace: "db",
        resource_type: "service",
        resource_name: "mysql-svc",
        port: 6543,
        kubeconfig_path: "/missing/kubeconfig",
      },
    ]);
    k8sMocks.validateK8sPath.mockImplementation(
      (_path: string, kind: "kubectl" | "kubeconfig") =>
        kind === "kubectl"
          ? Promise.resolve(undefined)
          : Promise.reject(new Error("missing kubeconfig")),
    );
    renderModal(15432);

    await waitFor(() => {
      expect(screen.getByText("Saved cluster")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("common.edit"));
    const kubectlInput = openAdvancedSettings();
    fireEvent.change(kubectlInput, { target: { value: "/opt/kubectl" } });
    fireEvent.blur(kubectlInput);

    await waitFor(() => {
      expect(k8sMocks.validateK8sPath).toHaveBeenCalledWith(
        "/opt/kubectl",
        "kubectl",
      );
    });
    expect(screen.getByLabelText("k8sConnections.chooseContext")).toHaveValue(
      "ctx",
    );

    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => {
      expect(screen.getByText("missing kubeconfig")).toBeInTheDocument();
      expect(
        screen.getByText("k8sConnections.pathValidationFailed"),
      ).toBeInTheDocument();
    });
    expect(k8sMocks.updateK8sConnection).not.toHaveBeenCalled();
  });

  it("does not report a stale invalid preflight after a replacement path applies", async () => {
    const staleValidation = createDeferred<void>();
    k8sMocks.validateK8sPath.mockImplementation((path: string) =>
      path === "/old/kubectl"
        ? staleValidation.promise
        : Promise.resolve(undefined),
    );
    k8sMocks.loadK8sConnections.mockResolvedValue([
      {
        id: "saved",
        name: "Saved cluster",
        context: "ctx",
        namespace: "db",
        resource_type: "service",
        resource_name: "mysql-svc",
        port: 6543,
        kubectl_path: "/old/kubectl",
      },
    ]);
    renderModal(15432);

    await waitFor(() => {
      expect(screen.getByText("Saved cluster")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("common.edit"));
    const kubectlInput = openAdvancedSettings();
    fireEvent.click(screen.getByText("k8sConnections.test"));
    await waitFor(() => {
      expect(k8sMocks.validateK8sPath).toHaveBeenCalledWith(
        "/old/kubectl",
        "kubectl",
      );
    });

    fireEvent.change(kubectlInput, { target: { value: "/new/kubectl" } });
    fireEvent.blur(kubectlInput);
    await waitFor(() => {
      expect(k8sMocks.getK8sContexts).toHaveBeenLastCalledWith(
        expect.objectContaining({ kubectl_path: "/new/kubectl" }),
      );
    });
    await act(async () => {
      staleValidation.resolve();
    });

    expect(
      screen.queryByText("k8sConnections.pathValidationFailed"),
    ).not.toBeInTheDocument();
  });

  it.each([
    { actionLabel: "k8sConnections.test", action: "test" },
    { actionLabel: "common.save", action: "save" },
  ] as const)(
    "aborts $action preflight when the selected context changes",
    async ({ actionLabel, action }) => {
      const validation = createDeferred<void>();
      k8sMocks.validateK8sPath.mockReturnValue(validation.promise);
      k8sMocks.getK8sContexts.mockResolvedValue(["ctx", "ctx-next"]);
      k8sMocks.loadK8sConnections.mockResolvedValue([
        {
          id: "saved",
          name: "Saved cluster",
          context: "ctx",
          namespace: "db",
          resource_type: "service",
          resource_name: "mysql-svc",
          port: 6543,
          kubectl_path: "/opt/kubectl",
        },
      ]);
      renderModal(15432);

      await waitFor(() => {
        expect(screen.getByText("Saved cluster")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByLabelText("common.edit"));
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
      expect(screen.getByText("k8sConnections.test")).toBeDisabled();
      expect(screen.getByText("common.save")).toBeDisabled();

      fireEvent.change(screen.getByLabelText("k8sConnections.chooseContext"), {
        target: { value: "ctx-next" },
      });
      await act(async () => {
        validation.resolve();
      });

      await waitFor(() => {
        expect(screen.getByText("common.save")).not.toBeDisabled();
      });
      if (action === "test") {
        expect(k8sMocks.testK8sConnection).not.toHaveBeenCalled();
      } else {
        expect(k8sMocks.updateK8sConnection).not.toHaveBeenCalled();
      }
    },
  );

  it("does not reset a superseding form when an older save completes", async () => {
    const update = createDeferred<void>();
    k8sMocks.updateK8sConnection.mockReturnValue(update.promise);
    k8sMocks.loadK8sConnections.mockResolvedValue([
      {
        id: "saved",
        name: "Saved cluster",
        context: "ctx",
        namespace: "db",
        resource_type: "service",
        resource_name: "mysql-svc",
        port: 6543,
      },
    ]);
    renderModal(15432);

    await waitFor(() => {
      expect(screen.getByText("Saved cluster")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("common.edit"));
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => {
      expect(k8sMocks.updateK8sConnection).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText("k8sConnections.add"));
    expect(
      screen.getByPlaceholderText("k8sConnections.namePlaceholder"),
    ).toHaveValue("");
    await act(async () => {
      update.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("k8sConnections.namePlaceholder"),
      ).toHaveValue("");
    });
  });

  it("suppresses stale namespace and resource discovery results", async () => {
    const firstNamespaces = createDeferred<string[]>();
    const secondNamespaces = createDeferred<string[]>();
    k8sMocks.getK8sContexts.mockResolvedValue(["ctx-a", "ctx-b"]);
    k8sMocks.getK8sNamespaces.mockImplementation((selectedContext: string) =>
      selectedContext === "ctx-a"
        ? firstNamespaces.promise
        : secondNamespaces.promise,
    );
    renderModal(15432);

    fireEvent.click(screen.getByText("k8sConnections.add"));
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "ctx-a" })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("k8sConnections.chooseContext"), {
      target: { value: "ctx-a" },
    });
    fireEvent.change(screen.getByLabelText("k8sConnections.chooseContext"), {
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
      (_context: string, selectedNamespace: string) =>
        selectedNamespace === "namespace-a"
          ? firstResources.promise
          : secondResources.promise,
    );
    fireEvent.change(screen.getByLabelText("k8sConnections.chooseNamespace"), {
      target: { value: "namespace-a" },
    });
    fireEvent.change(screen.getByLabelText("k8sConnections.chooseNamespace"), {
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

  it("suppresses a test result after its context is invalidated", async () => {
    const testResult = createDeferred<string>();
    k8sMocks.testK8sConnection.mockReturnValue(testResult.promise);
    renderModal(15432);

    fireEvent.click(screen.getByText("k8sConnections.add"));
    await fillRequiredFields();
    fireEvent.click(screen.getByText("k8sConnections.test"));
    await waitFor(() => {
      expect(k8sMocks.testK8sConnection).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("k8sConnections.chooseContext"), {
      target: { value: "" },
    });
    await act(async () => {
      testResult.resolve("obsolete success");
    });

    expect(screen.queryByText("obsolete success")).not.toBeInTheDocument();
  });

  it("suppresses a test result after the connection name changes", async () => {
    const testResult = createDeferred<string>();
    k8sMocks.testK8sConnection.mockReturnValue(testResult.promise);
    renderModal(15432);

    fireEvent.click(screen.getByText("k8sConnections.add"));
    await fillRequiredFields();
    fireEvent.click(screen.getByText("k8sConnections.test"));
    await waitFor(() => {
      expect(k8sMocks.testK8sConnection).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByPlaceholderText("k8sConnections.namePlaceholder"), {
      target: { value: "Changed while testing" },
    });
    await act(async () => {
      testResult.resolve("obsolete success");
    });

    expect(screen.queryByText("obsolete success")).not.toBeInTheDocument();
    expect(screen.queryByText("k8sConnections.testing")).not.toBeInTheDocument();
  });

  it("suppresses a test result after an unblurred path draft edit", async () => {
    const testResult = createDeferred<string>();
    k8sMocks.testK8sConnection.mockReturnValue(testResult.promise);
    renderModal(15432);

    fireEvent.click(screen.getByText("k8sConnections.add"));
    await fillRequiredFields();
    fireEvent.click(screen.getByText("k8sConnections.test"));
    await waitFor(() => {
      expect(k8sMocks.testK8sConnection).toHaveBeenCalled();
    });

    const kubectlInput = openAdvancedSettings();
    fireEvent.change(kubectlInput, { target: { value: "/new/kubectl" } });
    await act(async () => {
      testResult.resolve("obsolete success");
    });

    expect(screen.queryByText("obsolete success")).not.toBeInTheDocument();
  });

  it("blocks Save and Test when an advanced path is invalid", async () => {
    k8sMocks.validateK8sPath.mockRejectedValue(new Error("invalid kubectl"));
    renderModal(15432);

    fireEvent.click(screen.getByText("k8sConnections.add"));
    await fillRequiredFields();
    const kubectlInput = openAdvancedSettings();
    fireEvent.change(kubectlInput, { target: { value: "/bad/kubectl" } });
    fireEvent.blur(kubectlInput);

    await waitFor(() => {
      expect(screen.getByText("invalid kubectl")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("k8sConnections.test"));
    await waitFor(() => {
      expect(
        screen.getByText("k8sConnections.pathValidationFailed"),
      ).toBeInTheDocument();
    });
    expect(k8sMocks.testK8sConnection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => {
      expect(k8sMocks.saveK8sConnection).not.toHaveBeenCalled();
    });
  });

  it("resets dependent selections and ports when applied paths change", async () => {
    renderModal(15432);

    fireEvent.click(screen.getByText("k8sConnections.add"));
    await fillRequiredFields();
    const selectsBeforeApply = screen.getAllByRole(
      "combobox",
    ) as HTMLSelectElement[];
    fireEvent.change(selectsBeforeApply[2], { target: { value: "pod" } });
    const portInput = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(portInput, { target: { value: "7777" } });

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
    expect(selects[2]).toHaveValue("service");
    expect(selects[3]).toHaveValue("");
    expect(portInput).toHaveValue(15432);

    await fillRequiredFields();
    fireEvent.click(screen.getByText("k8sConnections.test"));
    await waitFor(() => {
      expect(k8sMocks.testK8sConnection).toHaveBeenCalledWith(
        "ctx",
        "db",
        expect.objectContaining({ kubectl_path: "/opt/kubectl" }),
      );
    });
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => {
      expect(k8sMocks.saveK8sConnection).toHaveBeenCalledWith(
        expect.objectContaining({ kubectl_path: "/opt/kubectl" }),
      );
    });
  });

  it("blocks a submit that applies new paths until selections are made again", async () => {
    renderModal(15432);

    fireEvent.click(screen.getByText("k8sConnections.add"));
    await fillRequiredFields();
    const kubectlInput = openAdvancedSettings();
    fireEvent.change(kubectlInput, { target: { value: "/opt/kubectl" } });

    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => {
      expect(
        screen.getByText("k8sConnections.pathSelectionReset"),
      ).toBeInTheDocument();
    });
    expect(k8sMocks.saveK8sConnection).not.toHaveBeenCalled();
  });

  it("does not clear an existing form validation error after path validation", async () => {
    k8sMocks.validateK8sConnection.mockReturnValue({
      isValid: false,
      errorKey: "k8sConnections.errors.nameRequired",
    });
    renderModal(15432);

    fireEvent.click(screen.getByText("k8sConnections.add"));
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() => {
      expect(
        screen.getByText("k8sConnections.errors.nameRequired"),
      ).toBeInTheDocument();
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
    expect(
      screen.getByText("k8sConnections.errors.nameRequired"),
    ).toBeInTheDocument();
  });
});
