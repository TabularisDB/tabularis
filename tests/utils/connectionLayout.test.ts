import { describe, it, expect } from 'vitest';
import {
  isConnectionGrouped,
  buildPanelDatabaseData,
  canActivateSplit,
  canAddToSplit,
  addToSplit,
  swapInSplit,
  moveInSplit,
  leaf,
  flattenLayout,
  layoutFromIds,
  makeSplitView,
  removeFromLayout,
  insertIntoLayout,
  getSplitNodeAt,
  resizeLayoutAt,
  computeLayoutGeometry,
  defaultSplitSizes,
  resizeSplitSizes,
  getPanelDropEdge,
  MAX_SPLIT_CONNECTIONS,
  MIN_SPLIT_PANE_SIZE,
  type SplitNode,
  type SplitView,
} from '../../src/utils/connectionLayout';
import type { ConnectionData } from '../../src/contexts/DatabaseContext';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Flat split view over the given ids (like activating a split) */
const view = (ids: string[], mode: 'vertical' | 'horizontal' = 'vertical'): SplitView => {
  const v = makeSplitView(layoutFromIds(ids, mode));
  if (!v) throw new Error('fixture requires at least one id');
  return v;
};

const split = (
  mode: 'vertical' | 'horizontal',
  children: SplitNode[],
  sizes?: number[],
): SplitNode => ({
  type: 'split',
  mode,
  children,
  sizes: sizes ?? defaultSplitSizes(children.length),
});

const makeConnectionData = (overrides?: Partial<ConnectionData>): ConnectionData => ({
  driver: 'postgres',
  connectionName: 'Test DB',
  databaseName: 'mydb',
  tables: [],
  views: [],
  routines: [],
  isLoadingTables: false,
  isLoadingViews: false,
  isLoadingRoutines: false,
  schemas: [],
  isLoadingSchemas: false,
  schemaDataMap: {},
  activeSchema: null,
  selectedSchemas: [],
  needsSchemaSelection: false,
  isConnecting: false,
  isConnected: true,
  ...overrides,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('connectionLayout', () => {
  describe('layoutFromIds / flattenLayout / makeSplitView', () => {
    it('builds a flat split and flattens back to the same ids', () => {
      const layout = layoutFromIds(['a', 'b', 'c'], 'vertical')!;
      expect(flattenLayout(layout)).toEqual(['a', 'b', 'c']);
    });

    it('builds a single leaf for one id', () => {
      expect(layoutFromIds(['a'], 'vertical')).toEqual(leaf('a'));
    });

    it('returns null for no ids', () => {
      expect(layoutFromIds([], 'vertical')).toBeNull();
      expect(makeSplitView(null)).toBeNull();
    });

    it('derives connectionIds and root mode', () => {
      const v = view(['a', 'b'], 'horizontal');
      expect(v.connectionIds).toEqual(['a', 'b']);
      expect(v.mode).toBe('horizontal');
    });

    it('flattens nested layouts depth-first', () => {
      const layout = split('vertical', [leaf('a'), split('horizontal', [leaf('b'), leaf('c')])]);
      expect(flattenLayout(layout)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('isConnectionGrouped', () => {
    it('returns false when splitView is null', () => {
      expect(isConnectionGrouped('conn-a', null)).toBe(false);
    });

    it('returns true for members and false for others', () => {
      const v = view(['conn-a', 'conn-b']);
      expect(isConnectionGrouped('conn-a', v)).toBe(true);
      expect(isConnectionGrouped('conn-b', v)).toBe(true);
      expect(isConnectionGrouped('conn-c', v)).toBe(false);
    });
  });

  describe('buildPanelDatabaseData', () => {
    it('returns connection data for a known connectionId', () => {
      const data = makeConnectionData({ driver: 'mysql' });
      expect(buildPanelDatabaseData('conn-a', { 'conn-a': data })).toBe(data);
    });

    it('returns undefined for unknown connectionId or empty map', () => {
      expect(buildPanelDatabaseData('nope', { 'conn-a': makeConnectionData() })).toBeUndefined();
      expect(buildPanelDatabaseData('conn-a', {})).toBeUndefined();
    });
  });

  describe('canActivateSplit', () => {
    it('requires at least 2 connections', () => {
      expect(canActivateSplit(new Set())).toBe(false);
      expect(canActivateSplit(new Set(['a']))).toBe(false);
      expect(canActivateSplit(new Set(['a', 'b']))).toBe(true);
    });

    it('caps at MAX_SPLIT_CONNECTIONS', () => {
      expect(canActivateSplit(new Set(['a', 'b', 'c', 'd']))).toBe(true);
      expect(canActivateSplit(new Set(['a', 'b', 'c', 'd', 'e']))).toBe(false);
    });
  });

  describe('canAddToSplit', () => {
    it('returns false when there is no split view', () => {
      expect(canAddToSplit(null, 'c')).toBe(false);
    });

    it('accepts new connections while the group has room', () => {
      expect(canAddToSplit(view(['a', 'b']), 'c')).toBe(true);
      expect(canAddToSplit(view(['a', 'b']), 'a')).toBe(false);
    });

    it('rejects additions to a full group', () => {
      const full = view(['a', 'b', 'c', 'd']);
      expect(full.connectionIds).toHaveLength(MAX_SPLIT_CONNECTIONS);
      expect(canAddToSplit(full, 'e')).toBe(false);
    });
  });

  describe('addToSplit', () => {
    it('appends to the root split and rescales shares', () => {
      const result = addToSplit(view(['a', 'b']), 'c');
      expect(result.connectionIds).toEqual(['a', 'b', 'c']);
      if (result.layout.type !== 'split') throw new Error('expected split root');
      expect(result.layout.sizes.reduce((s, x) => s + x, 0)).toBeCloseTo(100);
    });

    it('preserves the root mode', () => {
      expect(addToSplit(view(['a', 'b'], 'horizontal'), 'c').mode).toBe('horizontal');
    });

    it('returns the original view for duplicates or a full group', () => {
      const v = view(['a', 'b']);
      expect(addToSplit(v, 'a')).toBe(v);
      const full = view(['a', 'b', 'c', 'd']);
      expect(addToSplit(full, 'e')).toBe(full);
    });
  });

  describe('swapInSplit', () => {
    it('swaps two panels in place, even across nesting levels', () => {
      const v = makeSplitView(
        split('vertical', [leaf('a'), split('horizontal', [leaf('b'), leaf('c')])]),
      )!;
      const swapped = swapInSplit(v, 'a', 'c');
      expect(swapped.connectionIds).toEqual(['c', 'b', 'a']);
      // the tree shape is untouched, only the leaves exchanged
      expect(swapped.layout).toEqual(
        split('vertical', [leaf('c'), split('horizontal', [leaf('b'), leaf('a')])]),
      );
    });

    it('returns the original view for self-swaps or unknown ids', () => {
      const v = view(['a', 'b']);
      expect(swapInSplit(v, 'a', 'a')).toBe(v);
      expect(swapInSplit(v, 'a', 'x')).toBe(v);
    });
  });

  describe('removeFromLayout', () => {
    it('removes a leaf and rescales the remaining shares', () => {
      const result = removeFromLayout(layoutFromIds(['a', 'b', 'c'], 'vertical')!, 'b');
      expect(result && flattenLayout(result)).toEqual(['a', 'c']);
      if (!result || result.type !== 'split') throw new Error('expected split');
      expect(result.sizes.reduce((s, x) => s + x, 0)).toBeCloseTo(100);
    });

    it('collapses a split left with one child', () => {
      const nested = split('vertical', [leaf('a'), split('horizontal', [leaf('b'), leaf('c')])]);
      const result = removeFromLayout(nested, 'c');
      expect(result).toEqual(split('vertical', [leaf('a'), leaf('b')], [50, 50]));
    });

    it('returns null when the last leaf is removed', () => {
      expect(removeFromLayout(leaf('a'), 'a')).toBeNull();
    });

    it('returns an equivalent tree when the id is absent', () => {
      const layout = layoutFromIds(['a', 'b'], 'vertical')!;
      expect(removeFromLayout(layout, 'x')).toEqual(layout);
    });
  });

  describe('insertIntoLayout', () => {
    it('nests a new split when the drop direction differs from the parent', () => {
      const layout = layoutFromIds(['a', 'b'], 'vertical')!;
      const result = insertIntoLayout(layout, 'a', 'c', 'top');
      expect(result).toEqual(
        split('vertical', [split('horizontal', [leaf('c'), leaf('a')], [50, 50]), leaf('b')], [50, 50]),
      );
    });

    it('joins the parent split when the drop direction matches, halving the target share', () => {
      const layout = layoutFromIds(['a', 'b'], 'vertical')!;
      const result = insertIntoLayout(layout, 'a', 'c', 'right');
      expect(result).toEqual(
        split('vertical', [leaf('a'), leaf('c'), leaf('b')], [25, 25, 50]),
      );
    });

    it('places the new leaf before the target on left/top edges', () => {
      const layout = layoutFromIds(['a', 'b'], 'vertical')!;
      expect(flattenLayout(insertIntoLayout(layout, 'a', 'c', 'left'))).toEqual(['c', 'a', 'b']);
      expect(flattenLayout(insertIntoLayout(layout, 'b', 'c', 'right'))).toEqual(['a', 'b', 'c']);
    });
  });

  describe('moveInSplit', () => {
    it('re-tiles side by side on a side drop', () => {
      const moved = moveInSplit(view(['a', 'b', 'c']), 'c', 'a', 'left');
      expect(moved.connectionIds).toEqual(['c', 'a', 'b']);
      expect(moved.mode).toBe('vertical');
    });

    it('creates a mixed layout on a stacking drop', () => {
      // three columns, then c dropped below a: nested column inside the row
      const moved = moveInSplit(view(['a', 'b', 'c']), 'c', 'a', 'bottom');
      expect(moved.layout).toEqual(
        split('vertical', [split('horizontal', [leaf('a'), leaf('c')], [50, 50]), leaf('b')], [50, 50]),
      );
    });

    it('keeps the root mode of the remaining tree', () => {
      const moved = moveInSplit(view(['a', 'b'], 'vertical'), 'a', 'b', 'bottom');
      // removing a collapses the root to leaf b, then b/a stack horizontally
      expect(moved.mode).toBe('horizontal');
      expect(moved.connectionIds).toEqual(['b', 'a']);
    });

    it('returns the original view for self-drops or unknown ids', () => {
      const v = view(['a', 'b']);
      expect(moveInSplit(v, 'a', 'a', 'left')).toBe(v);
      expect(moveInSplit(v, 'x', 'a', 'left')).toBe(v);
      expect(moveInSplit(v, 'a', 'x', 'left')).toBe(v);
    });
  });

  describe('getSplitNodeAt / resizeLayoutAt', () => {
    const nested = split('vertical', [leaf('a'), split('horizontal', [leaf('b'), leaf('c')])]);

    it('resolves nodes by child-index path', () => {
      expect(getSplitNodeAt(nested, [])).toBe(nested);
      expect(getSplitNodeAt(nested, [0])).toEqual(leaf('a'));
      expect(getSplitNodeAt(nested, [1, 1])).toEqual(leaf('c'));
      expect(getSplitNodeAt(nested, [3])).toBeNull();
    });

    it('replaces sizes only at the addressed split', () => {
      const resized = resizeLayoutAt(nested, [1], [30, 70]);
      expect(getSplitNodeAt(resized, [1])).toEqual(
        split('horizontal', [leaf('b'), leaf('c')], [30, 70]),
      );
      if (resized.type !== 'split') throw new Error('expected split');
      expect(resized.sizes).toEqual([50, 50]);
    });
  });

  describe('computeLayoutGeometry', () => {
    it('lays out a flat vertical split as columns', () => {
      const { panes, dividers } = computeLayoutGeometry(layoutFromIds(['a', 'b'], 'vertical')!);
      expect(panes).toEqual([
        { connectionId: 'a', rect: { left: 0, top: 0, width: 50, height: 100 } },
        { connectionId: 'b', rect: { left: 50, top: 0, width: 50, height: 100 } },
      ]);
      expect(dividers).toEqual([
        { path: [], index: 0, mode: 'vertical', pos: 50, crossStart: 0, crossSize: 100, nodeMainSize: 100 },
      ]);
    });

    it('lays out nested splits with sub-rectangles', () => {
      const nested = split('vertical', [leaf('a'), split('horizontal', [leaf('b'), leaf('c')])]);
      const { panes, dividers } = computeLayoutGeometry(nested);
      expect(panes).toContainEqual({ connectionId: 'a', rect: { left: 0, top: 0, width: 50, height: 100 } });
      expect(panes).toContainEqual({ connectionId: 'b', rect: { left: 50, top: 0, width: 50, height: 50 } });
      expect(panes).toContainEqual({ connectionId: 'c', rect: { left: 50, top: 50, width: 50, height: 50 } });
      expect(dividers).toContainEqual({
        path: [1], index: 0, mode: 'horizontal', pos: 50, crossStart: 50, crossSize: 50, nodeMainSize: 100,
      });
    });

    it('respects uneven shares', () => {
      const { panes } = computeLayoutGeometry(
        split('vertical', [leaf('a'), leaf('b')], [25, 75]),
      );
      expect(panes[0].rect.width).toBe(25);
      expect(panes[1].rect).toEqual({ left: 25, top: 0, width: 75, height: 100 });
    });
  });

  describe('defaultSplitSizes', () => {
    it('returns equal shares summing to 100', () => {
      expect(defaultSplitSizes(2)).toEqual([50, 50]);
      expect(defaultSplitSizes(4)).toEqual([25, 25, 25, 25]);
      expect(defaultSplitSizes(3).reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    });
  });

  describe('resizeSplitSizes', () => {
    it('moves share between the two panes around the divider', () => {
      expect(resizeSplitSizes([50, 50], 0, 10)).toEqual([60, 40]);
      expect(resizeSplitSizes([25, 25, 25, 25], 1, -5)).toEqual([25, 20, 30, 25]);
    });

    it('keeps the total share constant', () => {
      expect(resizeSplitSizes([40, 30, 30], 0, 17).reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    });

    it('clamps both panes to the minimum size', () => {
      expect(resizeSplitSizes([50, 50], 0, 60)).toEqual([100 - MIN_SPLIT_PANE_SIZE, MIN_SPLIT_PANE_SIZE]);
      expect(resizeSplitSizes([50, 50], 0, -60)).toEqual([MIN_SPLIT_PANE_SIZE, 100 - MIN_SPLIT_PANE_SIZE]);
    });

    it('returns the original array when the delta is fully clamped away or the index is invalid', () => {
      const pinned = [MIN_SPLIT_PANE_SIZE, 100 - MIN_SPLIT_PANE_SIZE];
      expect(resizeSplitSizes(pinned, 0, -5)).toBe(pinned);
      const sizes = [50, 50];
      expect(resizeSplitSizes(sizes, -1, 10)).toBe(sizes);
      expect(resizeSplitSizes(sizes, 1, 10)).toBe(sizes);
    });
  });

  describe('getPanelDropEdge', () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };

    it('returns the edge closest to the pointer', () => {
      expect(getPanelDropEdge(rect, 10, 50)).toBe('left');
      expect(getPanelDropEdge(rect, 90, 50)).toBe('right');
      expect(getPanelDropEdge(rect, 50, 10)).toBe('top');
      expect(getPanelDropEdge(rect, 50, 90)).toBe('bottom');
    });

    it('accounts for the rect offset', () => {
      const offset = { left: 200, top: 100, width: 100, height: 100 };
      expect(getPanelDropEdge(offset, 210, 150)).toBe('left');
      expect(getPanelDropEdge(offset, 250, 190)).toBe('bottom');
    });

    it('handles degenerate rects without dividing by zero', () => {
      expect(() => getPanelDropEdge({ left: 0, top: 0, width: 0, height: 0 }, 5, 5)).not.toThrow();
    });
  });
});
