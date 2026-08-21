/**
 * Kubernetes connection utilities
 * Manages kubectl port-forward tunnel configurations
 */

import { invoke } from "@tauri-apps/api/core";

export interface K8sConnection {
  id: string;
  name: string;
  context: string;
  namespace: string;
  resource_type: "service" | "pod";
  resource_name: string;
  port: number;
  kubectl_path?: string;
  kubeconfig_path?: string;
}

export interface K8sConnectionInput {
  name: string;
  context: string;
  namespace: string;
  resource_type: string;
  resource_name: string;
  port: number;
  kubectl_path?: string;
  kubeconfig_path?: string;
}

export interface K8sCommandOptions {
  kubectl_path?: string;
  kubeconfig_path?: string;
}

export type K8sPathValidationKind = "kubectl" | "kubeconfig";

function toK8sCommandPayload(options?: K8sCommandOptions): {
  kubectlPath?: string;
  kubeconfigPath?: string;
} {
  return {
    ...(options?.kubectl_path !== undefined
      ? { kubectlPath: options.kubectl_path }
      : {}),
    ...(options?.kubeconfig_path !== undefined
      ? { kubeconfigPath: options.kubeconfig_path }
      : {}),
  };
}

/**
 * Load all saved K8s connections
 */
export async function loadK8sConnections(): Promise<K8sConnection[]> {
  try {
    return await invoke<K8sConnection[]>("get_k8s_connections");
  } catch (error) {
    console.error("Failed to load K8s connections:", error);
    return [];
  }
}

/**
 * Save a new K8s connection
 */
export async function saveK8sConnection(
  k8s: K8sConnectionInput
): Promise<K8sConnection> {
  return await invoke<K8sConnection>("save_k8s_connection", { k8s });
}

/**
 * Update an existing K8s connection
 */
export async function updateK8sConnection(
  id: string,
  k8s: K8sConnectionInput
): Promise<K8sConnection> {
  return await invoke<K8sConnection>("update_k8s_connection", { id, k8s });
}

/**
 * Delete a K8s connection
 */
export async function deleteK8sConnection(id: string): Promise<void> {
  await invoke("delete_k8s_connection", { id });
}

/**
 * Test a K8s connection (verify context and namespace reachability)
 */
export async function testK8sConnection(
  context: string,
  namespace: string,
  options?: K8sCommandOptions,
): Promise<string> {
  return await invoke<string>("test_k8s_connection_cmd", {
    context,
    namespace,
    ...toK8sCommandPayload(options),
  });
}

/**
 * List available kubectl contexts
 */
export async function getK8sContexts(
  options?: K8sCommandOptions,
): Promise<string[]> {
  const payload = toK8sCommandPayload(options);
  return Object.keys(payload).length === 0
    ? await invoke<string[]>("get_k8s_contexts_cmd")
    : await invoke<string[]>("get_k8s_contexts_cmd", payload);
}

/**
 * List namespaces in a kubectl context
 */
export async function getK8sNamespaces(
  context: string,
  options?: K8sCommandOptions,
): Promise<string[]> {
  return await invoke<string[]>("get_k8s_namespaces_cmd", {
    context,
    ...toK8sCommandPayload(options),
  });
}

/**
 * List resources (services or pods) in a context/namespace
 */
export async function getK8sResources(
  context: string,
  namespace: string,
  resourceType: string,
  options?: K8sCommandOptions,
): Promise<string[]> {
  return await invoke<string[]>("get_k8s_resources_cmd", {
    context,
    namespace,
    resourceType,
    ...toK8sCommandPayload(options),
  });
}

/**
 * List exposed ports for a Kubernetes resource.
 */
export async function getK8sResourcePorts(
  context: string,
  namespace: string,
  resourceType: string,
  resourceName: string,
  options?: K8sCommandOptions,
): Promise<number[]> {
  return await invoke<number[]>("get_k8s_resource_ports_cmd", {
    context,
    namespace,
    resourceType,
    resourceName,
    ...toK8sCommandPayload(options),
  });
}

/**
 * Validate an advanced K8s path override.
 */
export async function validateK8sPath(
  path: string,
  kind: K8sPathValidationKind,
): Promise<void> {
  await invoke("validate_k8s_path_cmd", { path, kind });
}

/**
 * Format a K8s connection for display
 */
export function formatK8sConnectionString(k8s: K8sConnection): string {
  return `${k8s.context}/${k8s.namespace}/${k8s.resource_type}/${k8s.resource_name}:${k8s.port}`;
}

/**
 * Validation result for K8s connection params
 */
export type K8sValidationErrorKey =
  | "k8sConnections.errors.nameRequired"
  | "k8sConnections.errors.contextRequired"
  | "k8sConnections.errors.namespaceRequired"
  | "k8sConnections.errors.resourceTypeInvalid"
  | "k8sConnections.errors.resourceNameRequired"
  | "k8sConnections.errors.portInvalid";

export type K8sValidationResult =
  | { isValid: true; value: K8sConnectionInput; errorKey?: undefined }
  | { isValid: false; errorKey: K8sValidationErrorKey; value?: undefined };

/**
 * Validate K8s connection parameters
 */
export function validateK8sConnection(
  k8s: Partial<K8sConnectionInput>
): K8sValidationResult {
  if (!k8s.name || k8s.name.trim() === "") {
    return { isValid: false, errorKey: "k8sConnections.errors.nameRequired" };
  }

  if (!k8s.context || k8s.context.trim() === "") {
    return { isValid: false, errorKey: "k8sConnections.errors.contextRequired" };
  }

  if (!k8s.namespace || k8s.namespace.trim() === "") {
    return { isValid: false, errorKey: "k8sConnections.errors.namespaceRequired" };
  }

  if (!k8s.resource_type || (k8s.resource_type !== "service" && k8s.resource_type !== "pod")) {
    return { isValid: false, errorKey: "k8sConnections.errors.resourceTypeInvalid" };
  }

  if (!k8s.resource_name || k8s.resource_name.trim() === "") {
    return { isValid: false, errorKey: "k8sConnections.errors.resourceNameRequired" };
  }

  if (!k8s.port || k8s.port < 1 || k8s.port > 65535) {
    return { isValid: false, errorKey: "k8sConnections.errors.portInvalid" };
  }

  return {
    isValid: true,
    value: {
      name: k8s.name,
      context: k8s.context,
      namespace: k8s.namespace,
      resource_type: k8s.resource_type,
      resource_name: k8s.resource_name,
      port: k8s.port,
      kubectl_path: k8s.kubectl_path,
      kubeconfig_path: k8s.kubeconfig_path,
    },
  };
}
