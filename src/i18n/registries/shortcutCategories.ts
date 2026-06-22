import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const shortcutCategories: Record<string, MessageDescriptor> = {
  editor: msg`Editor`,
  navigation: msg`Navigation`,
  data_grid: msg`Data Grid`,
};
