import { describe, it, expect, vi } from 'vitest';
import { useDatabase } from '../../src/hooks/useDatabase';
import { DatabaseContext, type DatabaseContextType } from '../../src/contexts/DatabaseContext';
import { renderHook } from '@testing-library/react';
import React, { type ReactNode } from 'react';

describe('useDatabase', () => {
  it('should throw error when used outside DatabaseProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => {
      renderHook(() => useDatabase());
    }).toThrow('useDatabase must be used within a DatabaseProvider');
    
    consoleSpy.mockRestore();
  });

  it('should return context value when used within DatabaseProvider', () => {
    const mockContextValue: DatabaseContextType = {
      activeConnectionId: 'conn-123',
      activeDriver: 'mysql',
      activeTable: 'users',
      activeConnectionName: 'Local MySQL',
      activeDatabaseName: 'mydb',
      tables: [{ name: 'users' }, { name: 'posts' }],
      isLoadingTables: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      setActiveTable: vi.fn(),
      refreshTables: vi.fn(),
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(DatabaseContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    expect(result.current.activeConnectionId).toBe('conn-123');
    expect(result.current.activeDriver).toBe('mysql');
    expect(result.current.activeTable).toBe('users');
    expect(result.current.activeConnectionName).toBe('Local MySQL');
    expect(result.current.activeDatabaseName).toBe('mydb');
    expect(result.current.tables).toHaveLength(2);
    expect(result.current.isLoadingTables).toBe(false);
  });

  it('should handle disconnected state', () => {
    const mockContextValue: DatabaseContextType = {
      activeConnectionId: null,
      activeDriver: null,
      activeTable: null,
      activeConnectionName: null,
      activeDatabaseName: null,
      tables: [],
      isLoadingTables: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      setActiveTable: vi.fn(),
      refreshTables: vi.fn(),
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(DatabaseContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    expect(result.current.activeConnectionId).toBeNull();
    expect(result.current.activeDriver).toBeNull();
    expect(result.current.tables).toHaveLength(0);
  });

  it('should handle loading state', () => {
    const mockContextValue: DatabaseContextType = {
      activeConnectionId: 'conn-123',
      activeDriver: 'postgres',
      activeTable: null,
      activeConnectionName: 'Prod Postgres',
      activeDatabaseName: 'production',
      tables: [],
      isLoadingTables: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      setActiveTable: vi.fn(),
      refreshTables: vi.fn(),
    };

    const wrapper = ({ children }: { children: ReactNode }) => 
      React.createElement(DatabaseContext.Provider, { value: mockContextValue }, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    expect(result.current.isLoadingTables).toBe(true);
    expect(result.current.activeDriver).toBe('postgres');
  });
});
