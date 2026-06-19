import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const quickNavigatorType: Record<string, MessageDescriptor> = {
  table: msg`table`,
  view: msg`view`,
  routine: msg`routine`,
  trigger: msg`trigger`,
};
