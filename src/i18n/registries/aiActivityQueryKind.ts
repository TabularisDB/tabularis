import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const aiActivityQueryKind: Record<string, MessageDescriptor> = {
  select: msg`Select`,
  write: msg`Write`,
  ddl: msg`DDL`,
  unknown: msg`Unknown`,
};
