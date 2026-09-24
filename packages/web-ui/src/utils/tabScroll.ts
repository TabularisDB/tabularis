export interface ScrollState {
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

export interface TabLike {
  id: string;
}

/**
 * Computes whether the scroll container can scroll left or right
 * based on its current scroll position and dimensions.
 */
export function getTabScrollState(element: Pick<HTMLElement, 'scrollLeft' | 'clientWidth' | 'scrollWidth'>): ScrollState {
  return {
    canScrollLeft: element.scrollLeft > 0,
    canScrollRight: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
  };
}

/**
 * Returns the index of the adjacent tab in the given direction.
 * When circular=true wraps around at the boundaries (like Alt+Tab).
 * When circular=false returns null at the boundary.
 */
export function getAdjacentTabIndex(
  currentIndex: number,
  tabCount: number,
  direction: 'left' | 'right',
  circular = false,
): number | null {
  if (tabCount === 0) return null;
  if (direction === 'left') {
    if (currentIndex > 0) return currentIndex - 1;
    return circular ? tabCount - 1 : null;
  }
  if (currentIndex < tabCount - 1) return currentIndex + 1;
  return circular ? 0 : null;
}

/**
 * Returns the id of the next tab in circular order starting from the current active tab.
 * Returns null if tabs is empty.
 */
export function resolveNextTabId(tabs: TabLike[], activeTabId: string | null): string | null {
  if (tabs.length === 0) return null;
  const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
  const nextIndex = getAdjacentTabIndex(currentIndex, tabs.length, 'right', true);
  if (nextIndex === null) return null;
  return tabs[nextIndex].id;
}

/**
 * Returns true if this editor pane should handle keyboard shortcuts.
 * In split mode (explorerConnectionId !== null) only the focused pane responds.
 * In single mode (explorerConnectionId === null) always returns true.
 */
export function isFocusedPane(
  explorerConnectionId: string | null,
  activeConnectionId: string | null,
): boolean {
  return explorerConnectionId === null || explorerConnectionId === activeConnectionId;
}

/**
 * Returns the CSS class string for a tab row in the switcher modal.
 */
export function getTabSwitcherRowClassName(isActive: boolean): string {
  const base = 'flex items-center gap-3 px-4 py-2.5 cursor-pointer group transition-colors';
  if (isActive) return `${base} bg-surface-secondary text-primary`;
  return `${base} text-secondary hover:bg-surface-secondary hover:text-primary`;
}
