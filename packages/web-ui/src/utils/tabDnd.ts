import type {Tab} from '@/types/editor';

/**
 * Gaps the tab at `index` may move to, so pinned tabs stay before unpinned ones: a
 * pinned tab moves within the pinned tabs, an unpinned one within the rest.
 */
function groupGapRange(connectionTabs: Tab[], index: number): [number, number] {
    const pinnedCount = connectionTabs.filter((t) => t.pinned).length;
    return connectionTabs[index].pinned ? [0, pinnedCount] : [pinnedCount, connectionTabs.length];
}

/**
 * Clamps a `moveTab` gap among one connection's tabs to the tab's own group (see
 * `groupGapRange`), so the drop indicator shows where the tab will land. Returns
 * `insertAt` as is for an unknown tab.
 */
export function clampTabGap(connectionTabs: Tab[], tabId: string, insertAt: number): number {
    const index = connectionTabs.findIndex((t) => t.id === tabId);
    if (index === -1) return insertAt;
    const [min, max] = groupGapRange(connectionTabs, index);
    return Math.min(Math.max(insertAt, min), max);
}

/**
 * Move a tab belonging to `connectionId` to a gap-based insertion point
 * among that connection's own tabs, leaving tabs from other connections in
 * their original array slots — dragging a tab never changes where another
 * connection's tabs sit relative to each other, since the user never sees
 * them while reordering. `insertAt` is the index of the gap *before* which
 * the tab should land, within the connection's own tab list — 0 means
 * "before the first tab of this connection", and the connection's tab count
 * means "after the last". Pinned tabs stay before unpinned ones: the gap is clamped
 * to the moved tab's own group.
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
    const [min, max] = groupGapRange(connectionTabs, fromIndex);
    const gap = Math.min(Math.max(insertAt, min), max);
    if (gap === fromIndex || gap === fromIndex + 1) return tabs;

    const reordered = [...connectionTabs];
    const [moved] = reordered.splice(fromIndex, 1);
    // After removing the tab, gaps past it shift left by one.
    const target = gap > fromIndex ? gap - 1 : gap;
    reordered.splice(target, 0, moved);

    let i = 0;
    return tabs.map((t) => (t.connectionId === connectionId ? reordered[i++] : t));
}

/**
 * Gap index for `moveTab` that shifts a tab one position among its
 * connection's own tabs, or `null` when the tab is already at that edge, including
 * the edge between pinned and unpinned tabs. Moving right targets `index + 2`
 * because `index + 1` is the tab's own trailing gap.
 */
export function getAdjacentTabGap(
    tabs: Tab[],
    connectionId: string,
    tabId: string,
    direction: 'left' | 'right',
): number | null {
    const connectionTabs = tabs.filter((t) => t.connectionId === connectionId);
    const index = connectionTabs.findIndex((t) => t.id === tabId);
    if (index === -1) return null;
    const gap = direction === 'left' ? index - 1 : index + 2;
    const [min, max] = groupGapRange(connectionTabs, index);
    return gap < min || gap > max ? null : gap;
}
