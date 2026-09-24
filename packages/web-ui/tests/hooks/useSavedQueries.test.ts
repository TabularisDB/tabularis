import { describe, it, expect, vi } from 'vitest';
import { useSavedQueries } from '../../src/hooks/useSavedQueries';
import { SavedQueriesContext, type SavedQueriesContextType, type SavedQuery } from '../../src/contexts/SavedQueriesContext';
import { renderHook } from '@testing-library/react';
import React, { type ReactNode } from 'react';

describe('useSavedQueries', () => {
  it('should throw error when used outside SavedQueriesProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => {
      renderHook(() => useSavedQueries());
    }).toThrow('useSavedQueries must be used within a SavedQueriesProvider');
    
    consoleSpy.mockRestore();
  });

  it('should return context value when used within SavedQueriesProvider', () => {
    const mockQueries: SavedQuery[] = [
      { id: 'query-1', name: 'All Users', sql: 'SELECT * FROM users', connection_id: 'conn-123' },
      { id: 'query-2', name: 'Active Orders', sql: 'SELECT * FROM orders WHERE status = "active"', connection_id: 'conn-123' },
    ];

    const mockContextValue: SavedQueriesContextType = {
      queries: mockQueries,
      isLoading: false,
      saveQuery: vi.fn(),
      updateQuery: vi.fn(),
      deleteQuery: vi.fn(),
      refreshQueries: vi.fn(),
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(SavedQueriesContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    expect(result.current.queries).toHaveLength(2);
    expect(result.current.queries[0].name).toBe('All Users');
    expect(result.current.queries[1].sql).toBe('SELECT * FROM orders WHERE status = "active"');
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle empty queries', () => {
    const mockContextValue: SavedQueriesContextType = {
      queries: [],
      isLoading: false,
      saveQuery: vi.fn(),
      updateQuery: vi.fn(),
      deleteQuery: vi.fn(),
      refreshQueries: vi.fn(),
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(SavedQueriesContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    expect(result.current.queries).toHaveLength(0);
  });

  it('should handle loading state', () => {
    const mockContextValue: SavedQueriesContextType = {
      queries: [],
      isLoading: true,
      saveQuery: vi.fn(),
      updateQuery: vi.fn(),
      deleteQuery: vi.fn(),
      refreshQueries: vi.fn(),
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(SavedQueriesContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    expect(result.current.isLoading).toBe(true);
  });

  it('should provide all query management functions', () => {
    const mockContextValue: SavedQueriesContextType = {
      queries: [],
      isLoading: false,
      saveQuery: vi.fn(),
      updateQuery: vi.fn(),
      deleteQuery: vi.fn(),
      refreshQueries: vi.fn(),
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(SavedQueriesContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useSavedQueries(), { wrapper });

    expect(typeof result.current.saveQuery).toBe('function');
    expect(typeof result.current.updateQuery).toBe('function');
    expect(typeof result.current.deleteQuery).toBe('function');
    expect(typeof result.current.refreshQueries).toBe('function');
  });
});
