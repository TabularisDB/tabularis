import { describe, it, expect } from 'vitest';
import {
  MAX_CLOSED_TABS,
  pushClosedTabs,
  popClosedTab,
  insertReopenedTab,
  type ClosedTabEntry,
  type ClosedTabsByConnection,
} from '../../src/utils/closedTabs';
import type { CleanedTab } from '../../src/utils/tabCleaner';
import type { Tab } from '../../src/types/editor';

const makeTab = (overrides: Partial<Tab> & Pick<Tab, 'id'>): Tab => ({
  title: `Tab ${overrides.id}`,
  type: 'console',
  query: `SELECT ${overrides.id}`,
  result: null,
  error: '',
  executionTime: null,
  page: 1,
  activeTable: null,
  pkColumns: null,
  connectionId: 'conn-1',
  ...overrides,
});

const makeCleaned = (id: string): CleanedTab => ({
  id,
  title: `Tab ${id}`,
  type: 'console',
  query: `SELECT ${id}`,
  page: 1,
  activeTable: null,
  pkColumns: null,
  connectionId: 'conn-1',
});

const entryIds = (stack: ClosedTabEntry[]) => stack.map((e) => e.tab.id);

describe('closedTabs', () => {
  describe('pushClosedTabs', () => {
    it('pushes closed tabs onto their connection stack with the index in the connection list', () => {
      const tabs = [
        makeTab({ id: 'a' }),
        makeTab({ id: 'b', type: 'table', activeTable: 'users' }),
        makeTab({ id: 'c' }),
      ];

      const next = pushClosedTabs({}, tabs, ['b']);

      expect(next['conn-1']).toHaveLength(1);
      expect(next['conn-1'][0].tab.id).toBe('b');
      expect(next['conn-1'][0].index).toBe(1);
    });

    it('keeps stacks isolated per connection', () => {
      const tabs = [
        makeTab({ id: 'a', connectionId: 'conn-1' }),
        makeTab({ id: 'b', connectionId: 'conn-1' }),
        makeTab({ id: 'c', connectionId: 'conn-2' }),
      ];

      const next = pushClosedTabs({}, tabs, ['b', 'c']);

      expect(entryIds(next['conn-1'])).toEqual(['b']);
      expect(entryIds(next['conn-2'])).toEqual(['c']);
    });

    it('accumulates in LIFO order across pushes', () => {
      const tabs = [makeTab({ id: 'a' }), makeTab({ id: 'b' })];
      let stacks: ClosedTabsByConnection = {};

      stacks = pushClosedTabs(stacks, tabs, ['a']);
      stacks = pushClosedTabs(stacks, tabs.filter((t) => t.id !== 'a'), ['b']);

      expect(entryIds(stacks['conn-1'])).toEqual(['a', 'b']);
    });

    it('pushes a multi-close left-to-right so the right-most tab is newest', () => {
      const tabs = [
        makeTab({ id: 'a' }),
        makeTab({ id: 'b' }),
        makeTab({ id: 'c' }),
      ];

      const next = pushClosedTabs({}, tabs, ['a', 'b', 'c']);

      expect(entryIds(next['conn-1'])).toEqual(['a', 'b', 'c']);
      expect(next['conn-1'].map((e) => e.index)).toEqual([0, 1, 2]);
    });

    it('skips notebook tabs', () => {
      const tabs = [
        makeTab({ id: 'a' }),
        makeTab({ id: 'nb', type: 'notebook', notebookId: 'nb-1' }),
      ];

      const next = pushClosedTabs({}, tabs, ['a', 'nb']);

      expect(entryIds(next['conn-1'])).toEqual(['a']);
    });

    it('ignores unknown ids', () => {
      const tabs = [makeTab({ id: 'a' })];

      const next = pushClosedTabs({}, tabs, ['missing', 'a']);

      expect(entryIds(next['conn-1'])).toEqual(['a']);
    });

    it('caps each stack at MAX_CLOSED_TABS dropping the oldest', () => {
      const tabs = Array.from({ length: MAX_CLOSED_TABS + 2 }, (_, i) =>
        makeTab({ id: `t${i}` }),
      );

      const next = pushClosedTabs({}, tabs, tabs.map((t) => t.id));

      expect(next['conn-1']).toHaveLength(MAX_CLOSED_TABS);
      expect(entryIds(next['conn-1'])).toEqual(
        tabs.slice(2).map((t) => t.id),
      );
    });

    it('strips runtime state from stored tabs', () => {
      const tab = makeTab({
        id: 'a',
        result: { columns: ['id'], rows: [[1]], affected_rows: 1 },
        error: 'boom',
        pendingChanges: { '1': { pkOriginalValue: 1, changes: { name: 'x' } } },
      });

      const next = pushClosedTabs({}, [tab], ['a']);
      const stored = next['conn-1'][0].tab;

      expect(stored).not.toHaveProperty('result');
      expect(stored).not.toHaveProperty('error');
      expect(stored).not.toHaveProperty('pendingChanges');
      expect(stored.query).toBe('SELECT a');
    });

    it('never mutates the input stacks or tab list', () => {
      const tabs = [makeTab({ id: 'a' }), makeTab({ id: 'b' })];
      const stacks: ClosedTabsByConnection = {
        'conn-1': [{ tab: makeCleaned('a'), index: 0 }],
      };
      const stacksSnapshot = JSON.stringify(stacks);
      const tabsSnapshot = JSON.stringify(tabs);

      pushClosedTabs(stacks, tabs, ['b']);

      expect(JSON.stringify(stacks)).toBe(stacksSnapshot);
      expect(JSON.stringify(tabs)).toBe(tabsSnapshot);
      expect(stacks['conn-1']).toHaveLength(1);
    });
  });

  describe('popClosedTab', () => {
    it('returns and removes the newest entry', () => {
      const stacks: ClosedTabsByConnection = {
        'conn-1': [
          { tab: makeCleaned('a'), index: 0 },
          { tab: makeCleaned('b'), index: 1 },
        ],
      };

      const { entry, stacks: next } = popClosedTab(stacks, 'conn-1');

      expect(entry?.tab.id).toBe('b');
      expect(entryIds(next['conn-1'])).toEqual(['a']);
      // Input untouched
      expect(stacks['conn-1']).toHaveLength(2);
    });

    it('returns a null entry for an empty or missing stack', () => {
      expect(popClosedTab({}, 'conn-1').entry).toBeNull();
      expect(popClosedTab({ 'conn-1': [] }, 'conn-1').entry).toBeNull();
    });
  });

  describe('insertReopenedTab', () => {
    it('reinserts the tab at its previous index among the connection tabs', () => {
      const before = [
        makeTab({ id: 'a' }),
        makeTab({ id: 'b', type: 'table', activeTable: 'users' }),
        makeTab({ id: 'c' }),
      ];
      const stacks = pushClosedTabs({}, before, ['b']);
      const entry = stacks['conn-1'][0];
      const current = [
        makeTab({ id: 'a' }),
        makeTab({ id: 'c' }),
        makeTab({ id: 'other', connectionId: 'conn-2' }),
      ];

      const { newTabs, tab } = insertReopenedTab(current, 'conn-1', entry);

      expect(tab.id).toBe('b');
      expect(tab.type).toBe('table');
      expect(tab.activeTable).toBe('users');
      expect(
        newTabs.filter((t) => t.connectionId === 'conn-1').map((t) => t.id),
      ).toEqual(['a', 'b', 'c']);
      // Other connections' tabs are untouched
      expect(newTabs.filter((t) => t.connectionId === 'conn-2').map((t) => t.id)).toEqual([
        'other',
      ]);
    });

    it('restores runtime state to fresh defaults', () => {
      const before = [
        makeTab({
          id: 'a',
          result: { columns: ['id'], rows: [[1]], affected_rows: 1 },
          error: 'boom',
          pendingChanges: { '1': { pkOriginalValue: 1, changes: { name: 'x' } } },
        }),
      ];
      const stacks = pushClosedTabs({}, before, ['a']);

      const { tab } = insertReopenedTab([], 'conn-1', stacks['conn-1'][0]);

      expect(tab.result).toBeNull();
      expect(tab.error).toBe('');
      expect(tab.pendingChanges).toBeUndefined();
      expect(tab.query).toBe('SELECT a');
    });

    it('clamps the stored index to the current connection tab count', () => {
      const before = [
        makeTab({ id: 'a' }),
        makeTab({ id: 'b' }),
        makeTab({ id: 'c' }),
      ];
      const stacks = pushClosedTabs({}, before, ['c']);
      const current = [makeTab({ id: 'a' })];

      const { newTabs } = insertReopenedTab(current, 'conn-1', stacks['conn-1'][0]);

      expect(newTabs.map((t) => t.id)).toEqual(['a', 'c']);
    });

    it('generates a new id when the stored id is already open', () => {
      const before = [makeTab({ id: 'a' })];
      const stacks = pushClosedTabs({}, before, ['a']);
      // The same id was re-created by another path in the meantime.
      const current = [makeTab({ id: 'a', query: 'different tab' })];

      const { newTabs, tab } = insertReopenedTab(current, 'conn-1', stacks['conn-1'][0]);

      expect(tab.id).not.toBe('a');
      expect(newTabs).toHaveLength(2);
      expect(newTabs.filter((t) => t.id === 'a')).toHaveLength(1);
    });
  });
});
