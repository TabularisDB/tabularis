import type { Tab } from "../types/editor";

/**
 * Move a tab belonging to `connectionId` to a gap-based insertion point
 * among that connection's own tabs, leaving tabs from other connections in
 * their original array slots — dragging a tab never changes where another
 * connection's tabs sit relative to each other, since the user never sees
 * them while reordering. `insertAt` is the index of the gap *before* which
 * the tab should land, within the connection's own tab list — 0 means
 * "before the first tab of this connection", and the connection's tab count
 * means "after the last".
 */
export function moveTab(
  tabs: Tab[],
  connectionId: string,
  fromTabId: string,
  insertAt: number,
): Tab[] {
  const connectionTabs = tabs.filter((t) => t.connectionId === connectionId);
  const fromIndex = connectionTabs.findIndex((t) => t.id === fromTabId);
  if (fromIndex === -1) return tabs;
  if (insertAt < 0 || insertAt > connectionTabs.length) return tabs;
  if (insertAt === fromIndex || insertAt === fromIndex + 1) return tabs;

  const reordered = [...connectionTabs];
  const [moved] = reordered.splice(fromIndex, 1);
  // After removing the tab, gaps past it shift left by one.
  const target = insertAt > fromIndex ? insertAt - 1 : insertAt;
  reordered.splice(target, 0, moved);

  let i = 0;
  return tabs.map((t) => (t.connectionId === connectionId ? reordered[i++] : t));
}
