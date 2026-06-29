import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  validateK8sConnection: k8sMocks.validateK8sConnection,
}));

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
});
