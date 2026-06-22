import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const shortcutLabels: Record<string, MessageDescriptor> = {
  "settings.shortcuts.runQuery": msg`Run query`,
  "settings.shortcuts.runQueryEditor": msg`Run query (in editor)`,
  "settings.shortcuts.newTab": msg`New tab`,
  "settings.shortcuts.closeTab": msg`Close tab`,
  "settings.shortcuts.nextPage": msg`Next page`,
  "settings.shortcuts.prevPage": msg`Previous page`,
  "settings.shortcuts.tabSwitcher": msg`Switch tab`,
  "settings.shortcuts.copySelection": msg`Copy selection`,
  "settings.shortcuts.toggleSidebar": msg`Toggle sidebar`,
  "settings.shortcuts.openConnections": msg`Open connections`,
  "settings.shortcuts.newConnection": msg`New connection`,
  "settings.shortcuts.switchConnection": msg`Switch to connection 1–9`,
  "settings.shortcuts.pasteImportClipboard": msg`Import from Clipboard`,
  "settings.shortcuts.notebookRunAll": msg`Run All Cells`,
  "settings.shortcuts.quickNavigator": msg`Quick Navigator`,
};
