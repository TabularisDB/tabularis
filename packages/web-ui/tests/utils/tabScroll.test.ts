import { describe, it, expect } from 'vitest';
import { getTabScrollState, getAdjacentTabIndex, resolveNextTabId, getTabSwitcherRowClassName, isFocusedPane } from '../../src/utils/tabScroll';

describe('tabScroll', () => {
  describe('getTabScrollState', () => {
    it('should return canScrollLeft=false and canScrollRight=false when content fits', () => {
      const result = getTabScrollState({ scrollLeft: 0, clientWidth: 500, scrollWidth: 500 });
      expect(result.canScrollLeft).toBe(false);
      expect(result.canScrollRight).toBe(false);
    });

    it('should return canScrollRight=true when content overflows to the right', () => {
      const result = getTabScrollState({ scrollLeft: 0, clientWidth: 300, scrollWidth: 600 });
      expect(result.canScrollLeft).toBe(false);
      expect(result.canScrollRight).toBe(true);
    });

    it('should return canScrollLeft=true when scrolled to the right', () => {
      const result = getTabScrollState({ scrollLeft: 100, clientWidth: 300, scrollWidth: 600 });
      expect(result.canScrollLeft).toBe(true);
      expect(result.canScrollRight).toBe(true);
    });

    it('should return canScrollLeft=true and canScrollRight=false when scrolled to the end', () => {
      const result = getTabScrollState({ scrollLeft: 300, clientWidth: 300, scrollWidth: 600 });
      expect(result.canScrollLeft).toBe(true);
      expect(result.canScrollRight).toBe(false);
    });

    it('should handle sub-pixel rounding with 1px tolerance', () => {
      // scrollLeft + clientWidth === scrollWidth - 1 means we are exactly at the boundary
      const result = getTabScrollState({ scrollLeft: 299, clientWidth: 300, scrollWidth: 600 });
      expect(result.canScrollRight).toBe(false);
    });

    it('should return canScrollRight=true when just below the 1px tolerance', () => {
      const result = getTabScrollState({ scrollLeft: 298, clientWidth: 300, scrollWidth: 600 });
      expect(result.canScrollRight).toBe(true);
    });
  });

  describe('getAdjacentTabIndex', () => {
    it('should return previous index when going left', () => {
      expect(getAdjacentTabIndex(2, 5, 'left')).toBe(1);
    });

    it('should return next index when going right', () => {
      expect(getAdjacentTabIndex(2, 5, 'right')).toBe(3);
    });

    it('should return null when going left from the first tab', () => {
      expect(getAdjacentTabIndex(0, 5, 'left')).toBeNull();
    });

    it('should return null when going right from the last tab', () => {
      expect(getAdjacentTabIndex(4, 5, 'right')).toBeNull();
    });

    it('should return null when going right with a single tab', () => {
      expect(getAdjacentTabIndex(0, 1, 'right')).toBeNull();
    });

    it('should return null when going left with a single tab', () => {
      expect(getAdjacentTabIndex(0, 1, 'left')).toBeNull();
    });

    it('should return 0 when going left from the second tab', () => {
      expect(getAdjacentTabIndex(1, 3, 'left')).toBe(0);
    });

    it('should return last index when going right from the second-to-last tab', () => {
      expect(getAdjacentTabIndex(3, 5, 'right')).toBe(4);
    });

    it('should return null for empty tab list', () => {
      expect(getAdjacentTabIndex(0, 0, 'right')).toBeNull();
      expect(getAdjacentTabIndex(0, 0, 'left')).toBeNull();
    });

    describe('circular=true', () => {
      it('should wrap from last to first when going right', () => {
        expect(getAdjacentTabIndex(4, 5, 'right', true)).toBe(0);
      });

      it('should wrap from first to last when going left', () => {
        expect(getAdjacentTabIndex(0, 5, 'left', true)).toBe(4);
      });

      it('should navigate normally when not at boundary (right)', () => {
        expect(getAdjacentTabIndex(2, 5, 'right', true)).toBe(3);
      });

      it('should navigate normally when not at boundary (left)', () => {
        expect(getAdjacentTabIndex(2, 5, 'left', true)).toBe(1);
      });

      it('should return null for empty tab list', () => {
        expect(getAdjacentTabIndex(0, 0, 'right', true)).toBeNull();
      });

      it('should wrap correctly with a single tab', () => {
        expect(getAdjacentTabIndex(0, 1, 'right', true)).toBe(0);
        expect(getAdjacentTabIndex(0, 1, 'left', true)).toBe(0);
      });
    });
  });

  describe('resolveNextTabId', () => {
    const tabs = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ];

    it('should return the next tab id', () => {
      expect(resolveNextTabId(tabs, 'a')).toBe('b');
    });

    it('should wrap from last to first', () => {
      expect(resolveNextTabId(tabs, 'c')).toBe('a');
    });

    it('should return first tab id when activeTabId is null', () => {
      expect(resolveNextTabId(tabs, null)).toBe('a');
    });

    it('should return first tab id when activeTabId is not found', () => {
      expect(resolveNextTabId(tabs, 'unknown')).toBe('a');
    });

    it('should return null for empty tab list', () => {
      expect(resolveNextTabId([], 'a')).toBeNull();
    });

    it('should return the same id with a single tab', () => {
      expect(resolveNextTabId([{ id: 'only' }], 'only')).toBe('only');
    });
  });

  describe('getTabSwitcherRowClassName', () => {
    it('should include active classes when isActive=true', () => {
      const cls = getTabSwitcherRowClassName(true);
      expect(cls).toContain('bg-surface-secondary');
      expect(cls).toContain('text-primary');
    });

    it('should include hover classes when isActive=false', () => {
      const cls = getTabSwitcherRowClassName(false);
      expect(cls).toContain('text-secondary');
      expect(cls).toContain('hover:bg-surface-secondary');
    });

    it('should always include base classes', () => {
      for (const active of [true, false]) {
        const cls = getTabSwitcherRowClassName(active);
        expect(cls).toContain('flex');
        expect(cls).toContain('cursor-pointer');
        expect(cls).toContain('transition-colors');
      }
    });

    it('should not include inactive classes when active', () => {
      const cls = getTabSwitcherRowClassName(true);
      expect(cls).not.toContain('text-secondary');
    });

    it('should not include active-only classes when inactive', () => {
      const cls = getTabSwitcherRowClassName(false);
      expect(cls).not.toContain('bg-surface-secondary text-primary');
    });
  });

  describe('isFocusedPane', () => {
    it('should return true in single mode (explorerConnectionId is null)', () => {
      expect(isFocusedPane(null, 'conn-1')).toBe(true);
      expect(isFocusedPane(null, null)).toBe(true);
    });

    it('should return true when this pane is the focused one in split mode', () => {
      expect(isFocusedPane('conn-1', 'conn-1')).toBe(true);
    });

    it('should return false when another pane is focused in split mode', () => {
      expect(isFocusedPane('conn-2', 'conn-1')).toBe(false);
    });

    it('should return false when activeConnectionId is null and split mode is active', () => {
      expect(isFocusedPane('conn-1', null)).toBe(false);
    });
  });
});
