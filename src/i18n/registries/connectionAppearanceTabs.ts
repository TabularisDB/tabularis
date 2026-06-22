import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const connectionAppearanceTabs: Record<string, MessageDescriptor> = {
  default: msg`Default`,
  pack: msg`Icon`,
  emoji: msg`Emoji`,
  image: msg`Image`,
};
