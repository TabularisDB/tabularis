import type {Tab} from '@/types/editor';

/** Bulk close actions of the tab context menu. */
export type BulkTabCloseAction = 'all' | 'others' | 'left' | 'right';

/**
 * Ids of the tabs a bulk close action closes, in tab order. `connectionTabs` are one
 * connection's tabs and `targetTabId` is the tab the menu was opened on ('all' ignores
 * it). Pinned tabs are never closed this way; closing a pinned tab directly still works.
 */
export function getBulkClosedTabIds(
    connectionTabs: Tab[],
    action: BulkTabCloseAction,
    targetTabId?: string,
): string[] {
    const targetIndex = connectionTabs.findIndex((tab) => tab.id === targetTabId);
    const inRange: Record<BulkTabCloseAction, (index: number) => boolean> = {
        all: () => true,
        others: (index) => index !== targetIndex,
        left: (index) => targetIndex !== -1 && index < targetIndex,
        right: (index) => targetIndex !== -1 && index > targetIndex,
    };
    return connectionTabs
        .filter((tab, index) => !tab.pinned && inRange[action](index))
        .map((tab) => tab.id);
}

/**
 * Puts a connection's pinned tabs before its unpinned ones, keeping the order inside
 * each group. Other connections' tabs keep their slots, and `tabs` is returned as is
 * when the order already holds.
 */
export function keepPinnedTabsFirst(tabs: Tab[], connectionId: string): Tab[] {
    const connectionTabs = tabs.filter((tab) => tab.connectionId === connectionId);
    const ordered = [
        ...connectionTabs.filter((tab) => tab.pinned),
        ...connectionTabs.filter((tab) => !tab.pinned),
    ];
    if (ordered.every((tab, index) => tab === connectionTabs[index])) return tabs;
    let next = 0;
    return tabs.map((tab) => (tab.connectionId === connectionId ? ordered[next++] : tab));
}

/**
 * Pins or unpins a tab. Either way it moves to the boundary between the two groups: a
 * pinned tab goes after the other pinned tabs, an unpinned one before the other unpinned
 * tabs. Returns `tabs` as is when the tab is missing or already in that state.
 */
export function setTabPinned(tabs: Tab[], tabId: string, pinned: boolean): Tab[] {
    const target = tabs.find((tab) => tab.id === tabId);
    if (!target || !!target.pinned === pinned) return tabs;
    const others = tabs.filter(
        (tab) => tab.connectionId === target.connectionId && tab.id !== tabId,
    );
    const ordered = [
        ...others.filter((tab) => tab.pinned),
        {...target, pinned},
        ...others.filter((tab) => !tab.pinned),
    ];
    let next = 0;
    return tabs.map((tab) => (tab.connectionId === target.connectionId ? ordered[next++] : tab));
}
