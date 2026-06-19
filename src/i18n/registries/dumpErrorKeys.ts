import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const dumpErrorKeys: Record<string, MessageDescriptor> = {
  "dump.errorNoOption": msg`Please select at least Structure or Data`,
  "dump.errorNoTables": msg`Please select at least one table`,
};
