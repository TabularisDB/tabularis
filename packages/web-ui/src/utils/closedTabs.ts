import type { Tab } from "../types/editor";
import type { CleanedTab } from "./tabCleaner";
import { cleanTabForStorage, restoreTabFromStorage } from "./tabCleaner";
import { generateTabId } from "./editor";

/** Maximum number of closed tabs remembered per connection (oldest dropped). */
export const MAX_CLOSED_TABS = 20;

export interface ClosedTabEntry {
  tab: CleanedTab;
  /** Position of the tab within its connection's tab list when it was closed. */
  index: number;
}

export type ClosedTabsByConnection = Record<string, ClosedTabEntry[]>;

/**
 * Records closed tabs onto their own connection's LIFO stack, in the order
 * given. Notebook tabs are skipped (they are reopened from the sidebar) and
 * unknown ids are ignored. The oldest entry is dropped once a stack exceeds
 * MAX_CLOSED_TABS. Neither `stacks` nor `tabsBeforeClose` is mutated.
 */
export function pushClosedTabs(
  stacks: ClosedTabsByConnection,
  tabsBeforeClose: Tab[],
  closedIds: string[],
): ClosedTabsByConnection {
  let next: ClosedTabsByConnection | null = null;

  for (const id of closedIds) {
    const tab = tabsBeforeClose.find((t) => t.id === id);
    if (!tab || tab.type === "notebook") continue;

    next = next ?? { ...stacks };
    const stack = next[tab.connectionId] ?? [];
    const index = tabsBeforeClose.filter(
      (t) => t.connectionId === tab.connectionId,
    ).findIndex((t) => t.id === id);

    const entries = [...stack, { tab: cleanTabForStorage(tab), index }];
    next[tab.connectionId] =
      entries.length > MAX_CLOSED_TABS
        ? entries.slice(entries.length - MAX_CLOSED_TABS)
        : entries;
  }

  return next ?? stacks;
}

/**
 * Removes and returns the newest closed-tab entry of a connection.
 * Returns a null entry when the connection's stack is empty.
 */
export function popClosedTab(
  stacks: ClosedTabsByConnection,
  connectionId: string,
): { entry: ClosedTabEntry | null; stacks: ClosedTabsByConnection } {
  const stack = stacks[connectionId];
  if (!stack || stack.length === 0) {
    return { entry: null, stacks };
  }
  return {
    entry: stack[stack.length - 1],
    stacks: { ...stacks, [connectionId]: stack.slice(0, -1) },
  };
}

/**
 * Rebuilds a closed tab (fresh results, no pending changes) and inserts it
 * into the full tabs array so it lands at its previous index among the
 * connection's tabs, clamped to the current tab count. Generates a fresh id
 * when the stored one is already taken by an open tab.
 */
export function insertReopenedTab(
  tabs: Tab[],
  connectionId: string,
  entry: ClosedTabEntry,
): { newTabs: Tab[]; tab: Tab } {
  const idTaken = tabs.some((t) => t.id === entry.tab.id);
  const tab = restoreTabFromStorage(
    idTaken ? { ...entry.tab, id: generateTabId() } : entry.tab,
  );

  const connectionPositions: number[] = [];
  tabs.forEach((t, i) => {
    if (t.connectionId === connectionId) connectionPositions.push(i);
  });
  const index = Math.min(Math.max(entry.index, 0), connectionPositions.length);

  const newTabs = [...tabs];
  if (index < connectionPositions.length) {
    newTabs.splice(connectionPositions[index], 0, tab);
  } else if (connectionPositions.length > 0) {
    newTabs.splice(
      connectionPositions[connectionPositions.length - 1] + 1,
      0,
      tab,
    );
  } else {
    newTabs.push(tab);
  }

  return { newTabs, tab };
}
