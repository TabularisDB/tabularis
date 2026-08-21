import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SavedQueriesProvider } from '../../src/contexts/SavedQueriesProvider';
import { useSavedQueries } from '../../src/hooks/useSavedQueries';
import { useDatabase } from '../../src/hooks/useDatabase';
import { invoke } from '@tauri-apps/api/core';
import React from 'react';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock useDatabase
vi.mock('../../src/hooks/useDatabase', () => ({
  useDatabase: vi.fn(),
}));

describe('SavedQueriesProvider', () => {
  const mockQueries = [
    { id: 'query-1', name: 'All Users', sql: 'SELECT * FROM users', connection_id: 'conn-123' },
    { id: 'query-2', name: 'Active Orders', sql: 'SELECT * FROM orders WHERE status = "active"', connection_id: 'conn-123' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDatabase).mockReturnValue({
      activeConnectionId: 'conn-123',
    } as ReturnType<typeof useDatabase>);
  });

  it('should provide initial empty state', () => {
    vi.mocked(invoke).mockResolvedValue([]);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SavedQueriesProvider, null, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    expect(result.current.queries).toHaveLength(0);
    expect(result.current.isLoading).toBe(true);
  });

  it('should load saved queries on mount', async () => {
    vi.mocked(invoke).mockResolvedValue(mockQueries);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SavedQueriesProvider, null, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    await waitFor(() => {
      expect(result.current.queries).toHaveLength(2);
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.queries[0].name).toBe('All Users');
    expect(result.current.queries[1].sql).toBe('SELECT * FROM orders WHERE status = "active"');
    expect(invoke).toHaveBeenCalledWith('get_saved_queries', { connectionId: 'conn-123' });
  });

  it('should clear queries when disconnected', async () => {
    vi.mocked(invoke).mockResolvedValue(mockQueries);
    vi.mocked(useDatabase).mockReturnValue({
      activeConnectionId: null,
    } as ReturnType<typeof useDatabase>);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SavedQueriesProvider, null, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    await waitFor(() => {
      expect(result.current.queries).toHaveLength(0);
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('should save a new query', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockQueries) // Initial load
      .mockResolvedValueOnce(undefined) // save_query
      .mockResolvedValueOnce([...mockQueries, { id: 'query-3', name: 'New Query', sql: 'SELECT 1', connection_id: 'conn-123' }]);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SavedQueriesProvider, null, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    await waitFor(() => expect(result.current.queries).toHaveLength(2));

    await result.current.saveQuery('New Query', 'SELECT 1');

    expect(invoke).toHaveBeenCalledWith('save_query', {
      connectionId: 'conn-123',
      name: 'New Query',
      sql: 'SELECT 1',
      database: null,
    });

    await waitFor(() => {
      expect(result.current.queries).toHaveLength(3);
    });
  });

  it('should not save query when disconnected', async () => {
    vi.mocked(useDatabase).mockReturnValue({
      activeConnectionId: null,
    } as ReturnType<typeof useDatabase>);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SavedQueriesProvider, null, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    await result.current.saveQuery('New Query', 'SELECT 1');

    expect(invoke).not.toHaveBeenCalledWith('save_query', expect.anything());
  });

  it('should update an existing query', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockQueries)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { ...mockQueries[0], name: 'Updated Users', sql: 'SELECT id, name FROM users' },
        mockQueries[1],
      ]);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SavedQueriesProvider, null, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    await waitFor(() => expect(result.current.queries).toHaveLength(2));

    await result.current.updateQuery('query-1', 'Updated Users', 'SELECT id, name FROM users');

    expect(invoke).toHaveBeenCalledWith('update_saved_query', {
      id: 'query-1',
      name: 'Updated Users',
      sql: 'SELECT id, name FROM users',
      database: null,
    });

    await waitFor(() => {
      expect(result.current.queries[0].name).toBe('Updated Users');
    });
  });

  it('should delete a query', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockQueries)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([mockQueries[1]]);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SavedQueriesProvider, null, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    await waitFor(() => expect(result.current.queries).toHaveLength(2));

    await result.current.deleteQuery('query-1');

    expect(invoke).toHaveBeenCalledWith('delete_saved_query', { id: 'query-1' });

    await waitFor(() => {
      expect(result.current.queries).toHaveLength(1);
      expect(result.current.queries[0].id).toBe('query-2');
    });
  });

  it('should handle save error', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockQueries)
      .mockRejectedValueOnce(new Error('Save failed'));

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SavedQueriesProvider, null, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    await waitFor(() => expect(result.current.queries).toHaveLength(2));

    await expect(result.current.saveQuery('New Query', 'SELECT 1')).rejects.toThrow('Save failed');
  });

  it('should refresh queries manually', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockQueries)
      .mockResolvedValueOnce([...mockQueries, { id: 'query-3', name: 'Another Query', sql: 'SELECT 2', connection_id: 'conn-123' }]);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SavedQueriesProvider, null, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    await waitFor(() => expect(result.current.queries).toHaveLength(2));

    await result.current.refreshQueries();

    await waitFor(() => {
      expect(result.current.queries).toHaveLength(3);
    });
  });
});
