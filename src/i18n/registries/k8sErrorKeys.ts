import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import type { K8sValidationErrorKey } from "../../utils/k8s";

export const k8sErrorKeys: Record<K8sValidationErrorKey, MessageDescriptor> = {
  "k8sConnections.errors.nameRequired": msg`Connection name is required`,
  "k8sConnections.errors.contextRequired": msg`Kubernetes context is required`,
  "k8sConnections.errors.namespaceRequired": msg`Namespace is required`,
  "k8sConnections.errors.resourceTypeInvalid": msg`Resource type must be "service" or "pod"`,
  "k8sConnections.errors.resourceNameRequired": msg`Resource name is required`,
  "k8sConnections.errors.portInvalid": msg`Port must be between 1 and 65535`,
};
