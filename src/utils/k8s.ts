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
}

export interface K8sConnectionInput {
  name: string;
  context: string;
  namespace: string;
  resource_type: string;
  resource_name: string;
  port: number;
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
  namespace: string
): Promise<string> {
  return await invoke<string>("test_k8s_connection_cmd", { context, namespace });
}

/**
 * List available kubectl contexts
 */
export async function getK8sContexts(): Promise<string[]> {
  return await invoke<string[]>("get_k8s_contexts_cmd");
}

/**
 * List namespaces in a kubectl context
 */
export async function getK8sNamespaces(context: string): Promise<string[]> {
  return await invoke<string[]>("get_k8s_namespaces_cmd", { context });
}

/**
 * List resources (services or pods) in a context/namespace
 */
export async function getK8sResources(
  context: string,
  namespace: string,
  resourceType: string
): Promise<string[]> {
  return await invoke<string[]>("get_k8s_resources_cmd", {
    context,
    namespace,
    resourceType,
  });
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
export interface K8sValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validate K8s connection parameters
 */
export function validateK8sConnection(
  k8s: Partial<K8sConnectionInput>
): K8sValidationResult {
  if (!k8s.name || k8s.name.trim() === "") {
    return { isValid: false, error: "Connection name is required" };
  }

  if (!k8s.context || k8s.context.trim() === "") {
    return { isValid: false, error: "Kubernetes context is required" };
  }

  if (!k8s.namespace || k8s.namespace.trim() === "") {
    return { isValid: false, error: "Namespace is required" };
  }

  if (!k8s.resource_type || (k8s.resource_type !== "service" && k8s.resource_type !== "pod")) {
    return { isValid: false, error: "Resource type must be 'service' or 'pod'" };
  }

  if (!k8s.resource_name || k8s.resource_name.trim() === "") {
    return { isValid: false, error: "Resource name is required" };
  }

  if (!k8s.port || k8s.port < 1 || k8s.port > 65535) {
    return { isValid: false, error: "Port must be between 1 and 65535" };
  }

  return { isValid: true };
}
