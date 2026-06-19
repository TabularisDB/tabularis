import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const taskManagerProcessStatus: Record<string, MessageDescriptor> = {
  running: msg`running`,
  stopped: msg`stopped`,
  unknown: msg`unknown`,
};
