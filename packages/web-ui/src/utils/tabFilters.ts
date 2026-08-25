import type { Tab } from '../types/editor';

export function filterTabsByConnection(tabs: Tab[], connectionId: string | null): Tab[] {
  if (!connectionId) return [];
  return tabs.filter((t) => t.connectionId === connectionId);
}

export function findTabById(tabs: Tab[], tabId: string | null): Tab | undefined {
  if (!tabId) return undefined;
  return tabs.find((t) => t.id === tabId);
}

export function getActiveTabForConnection(
  tabs: Tab[],
  connectionId: string | null,
  activeTabId: string | null
): Tab | null {
  if (!connectionId || !activeTabId) return null;

  const tab = findTabById(tabs, activeTabId);
  if (tab && tab.connectionId === connectionId) {
    return tab;
  }

  return null;
}

export function hasTabsForConnection(tabs: Tab[], connectionId: string | null): boolean {
  if (!connectionId) return false;
  return tabs.some((t) => t.connectionId === connectionId);
}

export function countTabsForConnection(tabs: Tab[], connectionId: string | null): number {
  return filterTabsByConnection(tabs, connectionId).length;
}
