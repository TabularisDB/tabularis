import type { Tab } from '../types/editor';

/**
 * Filters tabs to return only those belonging to a specific connection
 *
 * @param tabs - All tabs
 * @param connectionId - The connection ID to filter by
 * @returns Tabs belonging to the specified connection
 */
export function filterTabsByConnection(tabs: Tab[], connectionId: string | null): Tab[] {
  if (!connectionId) return [];
  return tabs.filter((t) => t.connectionId === connectionId);
}

/**
 * Finds a tab by its ID
 *
 * @param tabs - All tabs
 * @param tabId - The tab ID to find
 * @returns The tab if found, undefined otherwise
 */
export function findTabById(tabs: Tab[], tabId: string | null): Tab | undefined {
  if (!tabId) return undefined;
  return tabs.find((t) => t.id === tabId);
}

/**
 * Gets the active tab for a specific connection
 *
 * @param tabs - All tabs
 * @param connectionId - The connection ID
 * @param activeTabId - The active tab ID
 * @returns The active tab if found and belongs to the connection, or the first tab for the connection as fallback
 */
export function getActiveTabForConnection(
  tabs: Tab[],
  connectionId: string | null,
  activeTabId: string | null
): Tab | null {
  if (!connectionId) return null;

  // If we have an activeTabId, try to find that specific tab
  if (activeTabId) {
    const tab = findTabById(tabs, activeTabId);
    if (tab && tab.connectionId === connectionId) {
      return tab;
    }
  }

  // Fallback: return the first tab for this connection
  // This handles the race condition where tabs are created before activeTabIds is updated
  const connectionTabs = filterTabsByConnection(tabs, connectionId);
  return connectionTabs.length > 0 ? connectionTabs[0] : null;
}

/**
 * Checks if a connection has any tabs
 *
 * @param tabs - All tabs
 * @param connectionId - The connection ID to check
 * @returns True if the connection has at least one tab
 */
export function hasTabsForConnection(tabs: Tab[], connectionId: string | null): boolean {
  if (!connectionId) return false;
  return tabs.some((t) => t.connectionId === connectionId);
}

/**
 * Counts tabs for a specific connection
 *
 * @param tabs - All tabs
 * @param connectionId - The connection ID
 * @returns Number of tabs for the connection
 */
export function countTabsForConnection(tabs: Tab[], connectionId: string | null): number {
  return filterTabsByConnection(tabs, connectionId).length;
}
