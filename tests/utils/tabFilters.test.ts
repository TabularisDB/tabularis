import { describe, it, expect } from 'vitest';
import {
  filterTabsByConnection,
  findTabById,
  getActiveTabForConnection,
  hasTabsForConnection,
  countTabsForConnection,
} from '../../src/utils/tabFilters';
import type { Tab } from '../../src/types/editor';

const createMockTab = (id: string, connectionId: string, title: string = 'Tab'): Tab => ({
  id,
  title,
  type: 'console',
  query: '',
  page: 1,
  activeTable: null,
  pkColumns: null,
  connectionId,
  result: null,
  error: '',
  executionTime: null,
});

describe('tabFilters', () => {
  describe('filterTabsByConnection', () => {
    it('should return tabs for the specified connection', () => {
      const tabs: Tab[] = [
        createMockTab('tab1', 'conn1'),
        createMockTab('tab2', 'conn1'),
        createMockTab('tab3', 'conn2'),
      ];

      const result = filterTabsByConnection(tabs, 'conn1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('tab1');
      expect(result[1].id).toBe('tab2');
    });

    it('should return empty array for non-existent connection', () => {
      const tabs: Tab[] = [
        createMockTab('tab1', 'conn1'),
        createMockTab('tab2', 'conn2'),
      ];

      const result = filterTabsByConnection(tabs, 'conn3');

      expect(result).toHaveLength(0);
    });

    it('should return empty array when connectionId is null', () => {
      const tabs: Tab[] = [createMockTab('tab1', 'conn1')];

      const result = filterTabsByConnection(tabs, null);

      expect(result).toHaveLength(0);
    });

    it('should return empty array when tabs array is empty', () => {
      const result = filterTabsByConnection([], 'conn1');

      expect(result).toHaveLength(0);
    });

    it('should handle multiple tabs with same connection', () => {
      const tabs: Tab[] = [
        createMockTab('tab1', 'conn1'),
        createMockTab('tab2', 'conn1'),
        createMockTab('tab3', 'conn1'),
        createMockTab('tab4', 'conn2'),
      ];

      const result = filterTabsByConnection(tabs, 'conn1');

      expect(result).toHaveLength(3);
      expect(result.every((t) => t.connectionId === 'conn1')).toBe(true);
    });
  });

  describe('findTabById', () => {
    it('should find tab by id', () => {
      const tabs: Tab[] = [
        createMockTab('tab1', 'conn1'),
        createMockTab('tab2', 'conn1'),
        createMockTab('tab3', 'conn2'),
      ];

      const result = findTabById(tabs, 'tab2');

      expect(result).toBeDefined();
      expect(result?.id).toBe('tab2');
    });

    it('should return undefined for non-existent id', () => {
      const tabs: Tab[] = [createMockTab('tab1', 'conn1')];

      const result = findTabById(tabs, 'tab999');

      expect(result).toBeUndefined();
    });

    it('should return undefined when tabId is null', () => {
      const tabs: Tab[] = [createMockTab('tab1', 'conn1')];

      const result = findTabById(tabs, null);

      expect(result).toBeUndefined();
    });

    it('should return undefined when tabs array is empty', () => {
      const result = findTabById([], 'tab1');

      expect(result).toBeUndefined();
    });

    it('should return first match when multiple tabs have same id', () => {
      const tabs: Tab[] = [
        createMockTab('tab1', 'conn1', 'First'),
        createMockTab('tab1', 'conn2', 'Second'), // Duplicate id (shouldn't happen in practice)
      ];

      const result = findTabById(tabs, 'tab1');

      expect(result?.title).toBe('First');
    });
  });

  describe('getActiveTabForConnection', () => {
    it('should return active tab for the connection', () => {
      const tabs: Tab[] = [
        createMockTab('tab1', 'conn1'),
        createMockTab('tab2', 'conn1'),
        createMockTab('tab3', 'conn2'),
      ];

      const result = getActiveTabForConnection(tabs, 'conn1', 'tab2');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('tab2');
    });

    it('should return null if active tab belongs to different connection', () => {
      const tabs: Tab[] = [
        createMockTab('tab1', 'conn1'),
        createMockTab('tab2', 'conn2'),
      ];

      const result = getActiveTabForConnection(tabs, 'conn1', 'tab2');

      expect(result).toBeNull();
    });

    it('should return null when connectionId is null', () => {
      const tabs: Tab[] = [createMockTab('tab1', 'conn1')];

      const result = getActiveTabForConnection(tabs, null, 'tab1');

      expect(result).toBeNull();
    });

    it('should return null when activeTabId is null', () => {
      const tabs: Tab[] = [createMockTab('tab1', 'conn1')];

      const result = getActiveTabForConnection(tabs, 'conn1', null);

      expect(result).toBeNull();
    });

    it('should return null when tab does not exist', () => {
      const tabs: Tab[] = [createMockTab('tab1', 'conn1')];

      const result = getActiveTabForConnection(tabs, 'conn1', 'tab999');

      expect(result).toBeNull();
    });
  });

  describe('hasTabsForConnection', () => {
    it('should return true when connection has tabs', () => {
      const tabs: Tab[] = [
        createMockTab('tab1', 'conn1'),
        createMockTab('tab2', 'conn2'),
      ];

      const result = hasTabsForConnection(tabs, 'conn1');

      expect(result).toBe(true);
    });

    it('should return false when connection has no tabs', () => {
      const tabs: Tab[] = [createMockTab('tab1', 'conn1')];

      const result = hasTabsForConnection(tabs, 'conn2');

      expect(result).toBe(false);
    });

    it('should return false when connectionId is null', () => {
      const tabs: Tab[] = [createMockTab('tab1', 'conn1')];

      const result = hasTabsForConnection(tabs, null);

      expect(result).toBe(false);
    });

    it('should return false when tabs array is empty', () => {
      const result = hasTabsForConnection([], 'conn1');

      expect(result).toBe(false);
    });

    it('should return true when connection has multiple tabs', () => {
      const tabs: Tab[] = [
        createMockTab('tab1', 'conn1'),
        createMockTab('tab2', 'conn1'),
        createMockTab('tab3', 'conn1'),
      ];

      const result = hasTabsForConnection(tabs, 'conn1');

      expect(result).toBe(true);
    });
  });

  describe('countTabsForConnection', () => {
    it('should return correct count for connection', () => {
      const tabs: Tab[] = [
        createMockTab('tab1', 'conn1'),
        createMockTab('tab2', 'conn1'),
        createMockTab('tab3', 'conn2'),
      ];

      const result = countTabsForConnection(tabs, 'conn1');

      expect(result).toBe(2);
    });

    it('should return 0 for connection with no tabs', () => {
      const tabs: Tab[] = [createMockTab('tab1', 'conn1')];

      const result = countTabsForConnection(tabs, 'conn2');

      expect(result).toBe(0);
    });

    it('should return 0 when connectionId is null', () => {
      const tabs: Tab[] = [createMockTab('tab1', 'conn1')];

      const result = countTabsForConnection(tabs, null);

      expect(result).toBe(0);
    });

    it('should return 0 when tabs array is empty', () => {
      const result = countTabsForConnection([], 'conn1');

      expect(result).toBe(0);
    });

    it('should handle single tab', () => {
      const tabs: Tab[] = [createMockTab('tab1', 'conn1')];

      const result = countTabsForConnection(tabs, 'conn1');

      expect(result).toBe(1);
    });

    it('should count only tabs for specific connection', () => {
      const tabs: Tab[] = [
        createMockTab('tab1', 'conn1'),
        createMockTab('tab2', 'conn1'),
        createMockTab('tab3', 'conn1'),
        createMockTab('tab4', 'conn2'),
        createMockTab('tab5', 'conn2'),
        createMockTab('tab6', 'conn3'),
      ];

      expect(countTabsForConnection(tabs, 'conn1')).toBe(3);
      expect(countTabsForConnection(tabs, 'conn2')).toBe(2);
      expect(countTabsForConnection(tabs, 'conn3')).toBe(1);
    });
  });
});
