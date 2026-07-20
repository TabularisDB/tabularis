import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateK8sConnection,
  formatK8sConnectionString,
  testK8sConnection,
  getK8sContexts,
  getK8sNamespaces,
  getK8sResources,
  getK8sResourcePorts,
  validateK8sPath,
  loadK8sConnections,
  saveK8sConnection,
  updateK8sConnection,
  deleteK8sConnection,
  type K8sConnection,
  type K8sConnectionInput,
} from "../../src/utils/k8s";

// Mock Tauri's invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("k8s", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateK8sConnection", () => {
    const validInput: K8sConnectionInput = {
      name: "My Cluster",
      context: "gke_project_us-central1_cluster",
      namespace: "database",
      resource_type: "service",
      resource_name: "mysql-svc",
      port: 3306,
    };

    describe("required fields", () => {
      it("should fail when name is missing", () => {
        const result = validateK8sConnection({ ...validInput, name: "" });
        expect(result.isValid).toBe(false);
        expect(result.errorKey).toBe("k8sConnections.errors.nameRequired");
      });

      it("should fail when name is whitespace", () => {
        const result = validateK8sConnection({ ...validInput, name: "   " });
        expect(result.isValid).toBe(false);
        expect(result.errorKey).toBe("k8sConnections.errors.nameRequired");
      });

      it("should fail when context is missing", () => {
        const result = validateK8sConnection({ ...validInput, context: "" });
        expect(result.isValid).toBe(false);
        expect(result.errorKey).toBe("k8sConnections.errors.contextRequired");
      });

      it("should fail when namespace is missing", () => {
        const result = validateK8sConnection({
          ...validInput,
          namespace: "",
        });
        expect(result.isValid).toBe(false);
        expect(result.errorKey).toBe("k8sConnections.errors.namespaceRequired");
      });

      it("should fail when resource_name is missing", () => {
        const result = validateK8sConnection({
          ...validInput,
          resource_name: "",
        });
        expect(result.isValid).toBe(false);
        expect(result.errorKey).toBe("k8sConnections.errors.resourceNameRequired");
      });
    });

    describe("resource type validation", () => {
      it("should fail when resource_type is invalid", () => {
        const result = validateK8sConnection({
          ...validInput,
          resource_type: "deployment",
        });
        expect(result.isValid).toBe(false);
        expect(result.errorKey).toBe(
          "k8sConnections.errors.resourceTypeInvalid",
        );
      });

      it("should succeed with resource_type 'service'", () => {
        const result = validateK8sConnection({
          ...validInput,
          resource_type: "service",
        });
        expect(result.isValid).toBe(true);
      });

      it("should succeed with resource_type 'pod'", () => {
        const result = validateK8sConnection({
          ...validInput,
          resource_type: "pod",
        });
        expect(result.isValid).toBe(true);
      });
    });

    describe("port validation", () => {
      it("should fail when port is 0", () => {
        const result = validateK8sConnection({ ...validInput, port: 0 });
        expect(result.isValid).toBe(false);
        expect(result.errorKey).toBe("k8sConnections.errors.portInvalid");
      });

      it("should fail when port is > 65535", () => {
        const result = validateK8sConnection({
          ...validInput,
          port: 70000,
        });
        expect(result.isValid).toBe(false);
        expect(result.errorKey).toBe("k8sConnections.errors.portInvalid");
      });

      it("should succeed with port 1", () => {
        const result = validateK8sConnection({ ...validInput, port: 1 });
        expect(result.isValid).toBe(true);
      });

      it("should succeed with port 65535", () => {
        const result = validateK8sConnection({ ...validInput, port: 65535 });
        expect(result.isValid).toBe(true);
      });
    });

    it("should succeed with all valid fields", () => {
      const result = validateK8sConnection(validInput);
      expect(result.isValid).toBe(true);
    });
  });

  describe("formatK8sConnectionString", () => {
    it("should format K8s connection string correctly", () => {
      const k8s: K8sConnection = {
        id: "1",
        name: "My Cluster",
        context: "gke_project_cluster",
        namespace: "database",
        resource_type: "service",
        resource_name: "mysql-svc",
        port: 3306,
      };

      expect(formatK8sConnectionString(k8s)).toBe(
        "gke_project_cluster/database/service/mysql-svc:3306",
      );
    });

    it("should format pod connection string correctly", () => {
      const k8s: K8sConnection = {
        id: "2",
        name: "Dev Pod",
        context: "minikube",
        namespace: "default",
        resource_type: "pod",
        resource_name: "postgres-0",
        port: 5432,
      };

      expect(formatK8sConnectionString(k8s)).toBe(
        "minikube/default/pod/postgres-0:5432",
      );
    });
  });

  describe("testK8sConnection", () => {
    it("should call invoke with correct parameters", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue("K8s connection verified!");

      const result = await testK8sConnection("my-context", "my-namespace");

      expect(invoke).toHaveBeenCalledWith("test_k8s_connection_cmd", {
        context: "my-context",
        namespace: "my-namespace",
      });
      expect(result).toBe("K8s connection verified!");
    });

    it("should pass optional command overrides with camelCase Tauri arguments", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue("K8s connection verified!");

      await testK8sConnection("my-context", "my-namespace", {
        kubectl_path: "/opt/kubectl",
        kubeconfig_path: "/tmp/kubeconfig",
      });

      expect(invoke).toHaveBeenCalledWith("test_k8s_connection_cmd", {
        context: "my-context",
        namespace: "my-namespace",
        kubectlPath: "/opt/kubectl",
        kubeconfigPath: "/tmp/kubeconfig",
      });
    });

    it("should propagate errors from invoke", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockRejectedValue(new Error("Context not found"));

      await expect(
        testK8sConnection("bad-context", "default"),
      ).rejects.toThrow("Context not found");
    });
  });

  describe("getK8sContexts", () => {
    it("should return list of contexts without changing the no-options command payload", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue([
        "minikube",
        "gke_project_cluster",
      ]);

      const result = await getK8sContexts();

      expect(invoke).toHaveBeenCalledWith("get_k8s_contexts_cmd");
      expect(result).toEqual(["minikube", "gke_project_cluster"]);
    });

    it("should pass optional command overrides", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue(["minikube"]);

      await getK8sContexts({
        kubectl_path: "/opt/kubectl",
        kubeconfig_path: "/tmp/kubeconfig",
      });

      expect(invoke).toHaveBeenCalledWith("get_k8s_contexts_cmd", {
        kubectlPath: "/opt/kubectl",
        kubeconfigPath: "/tmp/kubeconfig",
      });
    });
  });

  describe("getK8sNamespaces", () => {
    it("should call invoke with context parameter", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue(["default", "kube-system"]);

      const result = await getK8sNamespaces("minikube");

      expect(invoke).toHaveBeenCalledWith("get_k8s_namespaces_cmd", {
        context: "minikube",
      });
      expect(result).toEqual(["default", "kube-system"]);
    });

    it("should pass optional command overrides", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue(["default"]);

      await getK8sNamespaces("minikube", {
        kubectl_path: "/opt/kubectl",
        kubeconfig_path: "/tmp/kubeconfig",
      });

      expect(invoke).toHaveBeenCalledWith("get_k8s_namespaces_cmd", {
        context: "minikube",
        kubectlPath: "/opt/kubectl",
        kubeconfigPath: "/tmp/kubeconfig",
      });
    });
  });

  describe("getK8sResources", () => {
    it("should call invoke with all parameters", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue(["mysql-svc", "postgres-svc"]);

      const result = await getK8sResources(
        "minikube",
        "database",
        "service",
      );

      expect(invoke).toHaveBeenCalledWith("get_k8s_resources_cmd", {
        context: "minikube",
        namespace: "database",
        resourceType: "service",
      });
      expect(result).toEqual(["mysql-svc", "postgres-svc"]);
    });

    it("should pass optional command overrides", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue(["mysql-svc"]);

      await getK8sResources("minikube", "database", "service", {
        kubectl_path: "/opt/kubectl",
        kubeconfig_path: "/tmp/kubeconfig",
      });

      expect(invoke).toHaveBeenCalledWith("get_k8s_resources_cmd", {
        context: "minikube",
        namespace: "database",
        resourceType: "service",
        kubectlPath: "/opt/kubectl",
        kubeconfigPath: "/tmp/kubeconfig",
      });
    });
  });

  describe("getK8sResourcePorts", () => {
    it("should call invoke with all parameters", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue([5432]);

      const result = await getK8sResourcePorts(
        "minikube",
        "database",
        "service",
        "postgres-svc",
      );

      expect(invoke).toHaveBeenCalledWith("get_k8s_resource_ports_cmd", {
        context: "minikube",
        namespace: "database",
        resourceType: "service",
        resourceName: "postgres-svc",
      });
      expect(result).toEqual([5432]);
    });

    it("should pass optional command overrides", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue([5432]);

      await getK8sResourcePorts(
        "minikube",
        "database",
        "service",
        "postgres-svc",
        {
          kubectl_path: "/opt/kubectl",
          kubeconfig_path: "/tmp/kubeconfig",
        },
      );

      expect(invoke).toHaveBeenCalledWith("get_k8s_resource_ports_cmd", {
        context: "minikube",
        namespace: "database",
        resourceType: "service",
        resourceName: "postgres-svc",
        kubectlPath: "/opt/kubectl",
        kubeconfigPath: "/tmp/kubeconfig",
      });
    });
  });

  describe("validateK8sPath", () => {
    it("should invoke the path validator with its exact contract", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue(undefined);

      await validateK8sPath("/opt/kubectl", "kubectl");

      expect(invoke).toHaveBeenCalledWith("validate_k8s_path_cmd", {
        path: "/opt/kubectl",
        kind: "kubectl",
      });
    });
  });

  describe("loadK8sConnections", () => {
    it("should return empty array on error", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockRejectedValue(new Error("File not found"));

      const result = await loadK8sConnections();
      expect(result).toEqual([]);
    });
  });

  describe("saveK8sConnection", () => {
    it("should call invoke with k8s parameter", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const saved: K8sConnection = {
        id: "abc-123",
        name: "Test",
        context: "minikube",
        namespace: "default",
        resource_type: "service",
        resource_name: "db",
        port: 3306,
      };
      vi.mocked(invoke).mockResolvedValue(saved);

      const input: K8sConnectionInput = {
        name: "Test",
        context: "minikube",
        namespace: "default",
        resource_type: "service",
        resource_name: "db",
        port: 3306,
      };

      const result = await saveK8sConnection(input);

      expect(invoke).toHaveBeenCalledWith("save_k8s_connection", {
        k8s: input,
      });
      expect(result).toEqual(saved);
    });
  });

  describe("updateK8sConnection", () => {
    it("should call invoke with id and k8s parameter", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const updated: K8sConnection = {
        id: "abc-123",
        name: "Updated",
        context: "minikube",
        namespace: "default",
        resource_type: "pod",
        resource_name: "db-0",
        port: 5432,
      };
      vi.mocked(invoke).mockResolvedValue(updated);

      const input: K8sConnectionInput = {
        name: "Updated",
        context: "minikube",
        namespace: "default",
        resource_type: "pod",
        resource_name: "db-0",
        port: 5432,
      };

      const result = await updateK8sConnection("abc-123", input);

      expect(invoke).toHaveBeenCalledWith("update_k8s_connection", {
        id: "abc-123",
        k8s: input,
      });
      expect(result).toEqual(updated);
    });
  });

  describe("deleteK8sConnection", () => {
    it("should call invoke with id parameter", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue(undefined);

      await deleteK8sConnection("abc-123");

      expect(invoke).toHaveBeenCalledWith("delete_k8s_connection", {
        id: "abc-123",
      });
    });
  });
});
