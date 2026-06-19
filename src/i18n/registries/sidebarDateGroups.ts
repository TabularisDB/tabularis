import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const sidebarDateGroups: Record<string, MessageDescriptor> = {
  dateGroupToday: msg`Today`,
  dateGroupYesterday: msg`Yesterday`,
  dateGroupThisWeek: msg`This Week`,
  dateGroupThisMonth: msg`This Month`,
  dateGroupOlder: msg`Older`,
};
