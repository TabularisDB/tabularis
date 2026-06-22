import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const aiActivityStatus: Record<string, MessageDescriptor> = {
  success: msg`Success`,
  blocked_readonly: msg`Blocked (read-only)`,
  blocked_pending_approval: msg`Pending approval`,
  denied: msg`Denied`,
  error: msg`Error`,
  timeout: msg`Timeout`,
};
