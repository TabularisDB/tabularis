import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { DatabaseProvider } from '../../src/contexts/DatabaseProvider';
import { useDatabase } from '../../src/hooks/useDatabase';
import { invoke } from '@tauri-apps/api/core';
import React from 'react';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('../../src/utils/autocomplete', () => ({
  clearAutocompleteCache: vi.fn(),
}));

vi.mock('../../src/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { activeExternalDrivers: [] },
    updateSetting: vi.fn(),
    isLoading: false,
  }),
}));

const mockPostgresManifest = {
  id: 'postgres',
  name: 'PostgreSQL',
  version: '1.0.0',
  description: '',
  default_port: 5432,
  capabilities: {
    schemas: true,
    views: true,
    routines: true,
    file_based: false,
    folder_based: false,
    identifier_quote: '"',
    alter_primary_key: true,
    serial_type: 'SERIAL',
    alter_column: true,
    create_foreign_keys: true,
  },
};

describe('DatabaseProvider', () => {
  const mockConnections = [
    {
      id: 'conn-123',
      name: 'Local MySQL',
      params: {
        driver: 'mysql',
        host: 'localhost',
        database: 'testdb',
      },
    },
  ];

  const mockTables = [
    { name: 'users' },
    { name: 'posts' },
    { name: 'comments' },
  ];

  const mockViews = [
    { name: 'active_users' },
    { name: 'user_posts_summary' },
  ];

  const mockRoutines = [
    { name: 'calculate_total', type: 'FUNCTION' },
    { name: 'update_user', type: 'PROCEDURE' },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    // Default mock implementation that handles all invoke calls
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'get_connections') return Promise.resolve(mockConnections);
      if (cmd === 'test_connection') return Promise.resolve('Connection successful!');
      if (cmd === 'get_tables') return Promise.resolve(mockTables);
      if (cmd === 'get_views') return Promise.resolve(mockViews);
      if (cmd === 'get_routines') return Promise.resolve(mockRoutines);
      if (cmd === 'set_window_title') return Promise.resolve(undefined);
      if (cmd === 'disconnect_connection') return Promise.resolve(undefined);
      if (cmd === 'register_active_connection') return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should persist empty connection list after connections have been opened', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DatabaseProvider, null, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    // Initially, should not persist empty state
    await waitFor(() => {
      expect(result.current.openConnectionIds).toEqual([]);
    });
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('set_last_open_connections', expect.anything());

    // Connect to a database
    await act(async () => {
      await result.current.connect('conn-123');
    });

    await waitFor(() => {
      expect(result.current.openConnectionIds).toEqual(['conn-123']);
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('set_last_open_connections', {
      connectionIds: ['conn-123'],
    });

    // Clear mock to track next call
    vi.mocked(invoke).mockClear();

    // Disconnect - should persist empty list
    await act(async () => {
      await result.current.disconnect();
    });

    await waitFor(() => {
      expect(result.current.openConnectionIds).toEqual([]);
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('set_last_open_connections', {
      connectionIds: [],
    });
  });

  it('should provide initial state', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DatabaseProvider, null, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    expect(result.current.activeConnectionId).toBeNull();
    expect(result.current.activeDriver).toBeNull();
    expect(result.current.activeTable).toBeNull();
    expect(result.current.tables).toHaveLength(0);
    expect(result.current.views).toHaveLength(0);
    expect(result.current.isLoadingTables).toBe(false);
    expect(result.current.isLoadingViews).toBe(false);
  });

  it('should connect and load tables', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DatabaseProvider, null, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    await act(async () => {
      await result.current.connect('conn-123');
    });

    await waitFor(() => {
      expect(result.current.activeConnectionId).toBe('conn-123');
      expect(result.current.activeDriver).toBe('mysql');
      expect(result.current.activeConnectionName).toBe('Local MySQL');
      expect(result.current.activeDatabaseName).toBe('testdb');
      expect(result.current.tables).toHaveLength(3);
      expect(result.current.views).toHaveLength(2);
      expect(result.current.isLoadingTables).toBe(false);
      expect(result.current.isLoadingViews).toBe(false);
    });

    expect(invoke).toHaveBeenCalledWith('get_connections');
    expect(invoke).toHaveBeenCalledWith('get_tables', { connectionId: 'conn-123' });
    expect(invoke).toHaveBeenCalledWith('get_views', { connectionId: 'conn-123' });
  });

  it('should handle connection failure', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('Connection failed'));

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DatabaseProvider, null, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    await act(async () => {
      await expect(result.current.connect('conn-123')).rejects.toThrow('Connection failed');
    });

    await waitFor(() => {
      expect(result.current.activeConnectionId).toBeNull();
      expect(result.current.activeDriver).toBeNull();
      expect(result.current.isLoadingTables).toBe(false);
    });
  });

  it('should disconnect and reset state', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'get_connections') return Promise.resolve(mockConnections);
      if (cmd === 'test_connection') return Promise.resolve('Connection successful!');
      if (cmd === 'get_tables') return Promise.resolve(mockTables);
      if (cmd === 'get_views') return Promise.resolve(mockViews);
      if (cmd === 'get_routines') return Promise.resolve(mockRoutines);
      if (cmd === 'set_window_title') return Promise.resolve(undefined);
      if (cmd === 'disconnect_connection') return Promise.resolve(undefined);
      if (cmd === 'register_active_connection') return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DatabaseProvider, null, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    await act(async () => {
      await result.current.connect('conn-123');
    });

    await waitFor(() => expect(result.current.activeConnectionId).toBe('conn-123'));

    await act(async () => {
      await result.current.disconnect();
    });

    // Should call disconnect_connection command
    expect(invoke).toHaveBeenCalledWith('disconnect_connection', { connectionId: 'conn-123' });

    // Should reset all state
    expect(result.current.activeConnectionId).toBeNull();
    expect(result.current.activeDriver).toBeNull();
    expect(result.current.activeTable).toBeNull();
    expect(result.current.tables).toHaveLength(0);
    expect(result.current.views).toHaveLength(0);
  });

  it('should keep previous connection open when connecting to a new one', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'get_connections') return Promise.resolve(mockConnections);
      if (cmd === 'test_connection') return Promise.resolve('Connection successful!');
      if (cmd === 'get_tables') return Promise.resolve(mockTables);
      if (cmd === 'get_views') return Promise.resolve(mockViews);
      if (cmd === 'get_routines') return Promise.resolve(mockRoutines);
      if (cmd === 'set_window_title') return Promise.resolve(undefined);
      if (cmd === 'disconnect_connection') return Promise.resolve(undefined);
      if (cmd === 'register_active_connection') return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DatabaseProvider, null, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    // Connect to first connection
    await act(async () => {
      await result.current.connect('conn-123');
    });

    await waitFor(() => expect(result.current.activeConnectionId).toBe('conn-123'));

    // Reset mock call counts
    vi.mocked(invoke).mockClear();

    // Connect to second connection
    const secondConnection = {
      id: 'conn-456',
      name: 'Second DB',
      params: {
        driver: 'postgres',
        host: 'localhost',
        database: 'seconddb',
      },
    };

    vi.mocked(invoke).mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'get_connections') return Promise.resolve([...mockConnections, secondConnection]);
      if (cmd === 'test_connection') return Promise.resolve('Connection successful!');
      if (cmd === 'get_schemas') return Promise.resolve(['public']);
      if (cmd === 'get_selected_schemas') return Promise.resolve(['public']);
      if (cmd === 'get_schema_preference') return Promise.resolve('public');
      if (cmd === 'get_tables') return Promise.resolve(mockTables);
      if (cmd === 'get_views') return Promise.resolve(mockViews);
      if (cmd === 'get_routines') return Promise.resolve(mockRoutines);
      if (cmd === 'set_window_title') return Promise.resolve(undefined);
      if (cmd === 'disconnect_connection') return Promise.resolve(undefined);
      if (cmd === 'register_active_connection') return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    await act(async () => {
      await result.current.connect('conn-456');
    });

    // Should NOT have disconnected the previous connection (multiple connections supported)
    expect(invoke).not.toHaveBeenCalledWith('disconnect_connection', { connectionId: 'conn-123' });

    // Should be connected to the new connection
    await waitFor(() => {
      expect(result.current.activeConnectionId).toBe('conn-456');
      expect(result.current.activeConnectionName).toBe('Second DB');
      expect(result.current.activeDatabaseName).toBe('seconddb');
    });
  });

  it('should refresh tables', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DatabaseProvider, null, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    await act(async () => {
      await result.current.connect('conn-123');
    });
    
    await waitFor(() => expect(result.current.tables).toHaveLength(3));

    // Update mock to return additional table
    const updatedTables = [...mockTables, { name: 'new_table' }];
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'get_connections') return Promise.resolve(mockConnections);
      if (cmd === 'test_connection') return Promise.resolve('Connection successful!');
      if (cmd === 'get_tables') return Promise.resolve(updatedTables);
      if (cmd === 'get_views') return Promise.resolve(mockViews);
      if (cmd === 'get_routines') return Promise.resolve(mockRoutines);
      if (cmd === 'set_window_title') return Promise.resolve(undefined);
      if (cmd === 'disconnect_connection') return Promise.resolve(undefined);
      if (cmd === 'register_active_connection') return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unexpected command: ${cmd}`));
    });

    await act(async () => {
      await result.current.refreshTables();
    });

    await waitFor(() => {
      expect(result.current.tables).toHaveLength(4);
    });
    expect(result.current.tables.map((t) => t.name)).toContain('new_table');
  });

  it('should not refresh tables when disconnected', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DatabaseProvider, null, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    await act(async () => {
      await result.current.refreshTables();
    });

    // Should not invoke get_tables when disconnected
    expect(invoke).not.toHaveBeenCalledWith('get_tables', expect.anything());
  });

  it('should set active table', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DatabaseProvider, null, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    await act(async () => {
      await result.current.connect('conn-123');
    });
    
    await waitFor(() => expect(result.current.activeConnectionId).toBe('conn-123'));

    act(() => {
      result.current.setActiveTable('users');
    });

    expect(result.current.activeTable).toBe('users');

    act(() => {
      result.current.setActiveTable(null);
    });

    expect(result.current.activeTable).toBeNull();
  });

  it('should update window title on connection', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DatabaseProvider, null, children);

    const { result } = renderHook(() => useDatabase(), { wrapper });

    await act(async () => {
      await result.current.connect('conn-123');
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('set_window_title', {
        title: 'tabularis - Local MySQL (testdb)',
      });
    });
  });

  describe('Views Management', () => {
    it('should load views on connection', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DatabaseProvider, null, children);

      const { result } = renderHook(() => useDatabase(), { wrapper });

      await act(async () => {
        await result.current.connect('conn-123');
      });

      await waitFor(() => {
        expect(result.current.views).toHaveLength(2);
        expect(result.current.views[0].name).toBe('active_users');
        expect(result.current.views[1].name).toBe('user_posts_summary');
        expect(result.current.isLoadingViews).toBe(false);
      });
    });

    it('should refresh views', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DatabaseProvider, null, children);

      const { result } = renderHook(() => useDatabase(), { wrapper });

      await act(async () => {
        await result.current.connect('conn-123');
      });

      await waitFor(() => expect(result.current.views).toHaveLength(2));

      // Update mock to return additional view
      const updatedViews = [...mockViews, { name: 'new_view' }];
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === 'get_connections') return Promise.resolve(mockConnections);
        if (cmd === 'test_connection') return Promise.resolve('Connection successful!');
        if (cmd === 'get_tables') return Promise.resolve(mockTables);
        if (cmd === 'get_views') return Promise.resolve(updatedViews);
        if (cmd === 'get_routines') return Promise.resolve(mockRoutines);
        if (cmd === 'set_window_title') return Promise.resolve(undefined);
        if (cmd === 'disconnect_connection') return Promise.resolve(undefined);
        return Promise.reject(new Error(`Unexpected command: ${cmd}`));
      });

      await act(async () => {
        await result.current.refreshViews();
      });

      await waitFor(() => {
        expect(result.current.views).toHaveLength(3);
      });
      expect(result.current.views.map((v) => v.name)).toContain('new_view');
    });

    it('should not refresh views when disconnected', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DatabaseProvider, null, children);

      const { result } = renderHook(() => useDatabase(), { wrapper });

      await act(async () => {
        await result.current.refreshViews();
      });

      // Should not invoke get_views when disconnected
      expect(invoke).not.toHaveBeenCalledWith('get_views', expect.anything());
    });

    it('should handle views loading state during connection', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DatabaseProvider, null, children);

      const { result } = renderHook(() => useDatabase(), { wrapper });

      // Start connection
      act(() => {
        result.current.connect('conn-123');
      });

      // Should be loading immediately after starting connection
      expect(result.current.isLoadingViews).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoadingViews).toBe(false);
      });
    });

    it('should clear views on disconnect', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DatabaseProvider, null, children);

      const { result } = renderHook(() => useDatabase(), { wrapper });

      await act(async () => {
        await result.current.connect('conn-123');
      });

      await waitFor(() => expect(result.current.views).toHaveLength(2));

      await act(async () => {
        await result.current.disconnect();
      });

      expect(result.current.views).toHaveLength(0);
    });
  });

  describe('PostgreSQL Schema Selection', () => {
    const mockPgConnections = [
      {
        id: 'pg-conn',
        name: 'Local Postgres',
        params: {
          driver: 'postgres',
          host: 'localhost',
          database: 'mydb',
        },
      },
    ];

    const mockSchemas = ['public', 'analytics', 'staging'];
    const mockPgTables = [{ name: 'users' }, { name: 'orders' }];
    const mockPgViews = [{ name: 'active_users' }];
    const mockPgRoutines = [{ name: 'calc', routine_type: 'FUNCTION' }];

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DatabaseProvider, null, children);

    it('should set needsSchemaSelection=true when no saved selection exists', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === 'get_connections') return Promise.resolve(mockPgConnections);
        if (cmd === 'test_connection') return Promise.resolve('Connection successful!');
        if (cmd === 'get_driver_manifest') return Promise.resolve(mockPostgresManifest);
        if (cmd === 'get_schemas') return Promise.resolve(mockSchemas);
        if (cmd === 'get_selected_schemas') return Promise.resolve([]);
        if (cmd === 'set_window_title') return Promise.resolve(undefined);
        if (cmd === 'disconnect_connection') return Promise.resolve(undefined);
        return Promise.resolve([]);
      });

      const { result } = renderHook(() => useDatabase(), { wrapper });

      await act(async () => {
        await result.current.connect('pg-conn');
      });

      await waitFor(() => {
        expect(result.current.needsSchemaSelection).toBe(true);
        expect(result.current.selectedSchemas).toEqual([]);
      });

      // Should NOT load tables/views when no schemas selected
      expect(invoke).not.toHaveBeenCalledWith('get_tables', expect.objectContaining({ connectionId: 'pg-conn' }));
    });

    it('should load only selected schemas when saved selection exists', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string, args?: Record<string, unknown>) => {
        if (cmd === 'get_connections') return Promise.resolve(mockPgConnections);
        if (cmd === 'test_connection') return Promise.resolve('Connection successful!');
        if (cmd === 'get_driver_manifest') return Promise.resolve(mockPostgresManifest);
        if (cmd === 'get_schemas') return Promise.resolve(mockSchemas);
        if (cmd === 'get_selected_schemas') return Promise.resolve(['public']);
        if (cmd === 'get_schema_preference') return Promise.resolve('public');
        if (cmd === 'get_tables') return Promise.resolve(mockPgTables);
        if (cmd === 'get_views') return Promise.resolve(mockPgViews);
        if (cmd === 'get_routines') return Promise.resolve(mockPgRoutines);
        if (cmd === 'set_window_title') return Promise.resolve(undefined);
        if (cmd === 'disconnect_connection') return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useDatabase(), { wrapper });

      await act(async () => {
        await result.current.connect('pg-conn');
      });

      await waitFor(() => {
        expect(result.current.needsSchemaSelection).toBe(false);
        expect(result.current.selectedSchemas).toEqual(['public']);
        expect(result.current.activeSchema).toBe('public');
      });

      // Should have loaded tables for 'public' schema
      expect(invoke).toHaveBeenCalledWith('get_tables', { connectionId: 'pg-conn', schema: 'public' });
    });

    it('should persist and load data when setSelectedSchemas is called', async () => {
      // Start with no saved selection (needsSchemaSelection=true)
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === 'get_connections') return Promise.resolve(mockPgConnections);
        if (cmd === 'test_connection') return Promise.resolve('Connection successful!');
        if (cmd === 'get_driver_manifest') return Promise.resolve(mockPostgresManifest);
        if (cmd === 'get_schemas') return Promise.resolve(mockSchemas);
        if (cmd === 'get_selected_schemas') return Promise.resolve([]);
        if (cmd === 'set_selected_schemas') return Promise.resolve(undefined);
        if (cmd === 'set_schema_preference') return Promise.resolve(undefined);
        if (cmd === 'set_window_title') return Promise.resolve(undefined);
        if (cmd === 'get_tables') return Promise.resolve(mockPgTables);
        if (cmd === 'get_views') return Promise.resolve(mockPgViews);
        if (cmd === 'get_routines') return Promise.resolve(mockPgRoutines);
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useDatabase(), { wrapper });

      await act(async () => {
        await result.current.connect('pg-conn');
      });

      await waitFor(() => {
        expect(result.current.needsSchemaSelection).toBe(true);
      });

      // User selects schemas
      await act(async () => {
        await result.current.setSelectedSchemas(['public', 'analytics']);
      });

      await waitFor(() => {
        expect(result.current.needsSchemaSelection).toBe(false);
        expect(result.current.selectedSchemas).toEqual(['public', 'analytics']);
      });

      // Should have persisted
      expect(invoke).toHaveBeenCalledWith('set_selected_schemas', {
        connectionId: 'pg-conn',
        schemas: ['public', 'analytics'],
      });
    });

    it('should update activeSchema when removed from selection', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === 'get_connections') return Promise.resolve(mockPgConnections);
        if (cmd === 'test_connection') return Promise.resolve('Connection successful!');
        if (cmd === 'get_driver_manifest') return Promise.resolve(mockPostgresManifest);
        if (cmd === 'get_schemas') return Promise.resolve(mockSchemas);
        if (cmd === 'get_selected_schemas') return Promise.resolve(['public', 'analytics']);
        if (cmd === 'get_schema_preference') return Promise.resolve('analytics');
        if (cmd === 'set_selected_schemas') return Promise.resolve(undefined);
        if (cmd === 'set_schema_preference') return Promise.resolve(undefined);
        if (cmd === 'set_window_title') return Promise.resolve(undefined);
        if (cmd === 'get_tables') return Promise.resolve(mockPgTables);
        if (cmd === 'get_views') return Promise.resolve(mockPgViews);
        if (cmd === 'get_routines') return Promise.resolve(mockPgRoutines);
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useDatabase(), { wrapper });

      await act(async () => {
        await result.current.connect('pg-conn');
      });

      await waitFor(() => {
        expect(result.current.activeSchema).toBe('analytics');
      });

      // Remove analytics from selection
      await act(async () => {
        await result.current.setSelectedSchemas(['public']);
      });

      await waitFor(() => {
        expect(result.current.activeSchema).toBe('public');
      });
    });

    it('should reset schema selection state on disconnect', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === 'get_connections') return Promise.resolve(mockPgConnections);
        if (cmd === 'test_connection') return Promise.resolve('Connection successful!');
        if (cmd === 'get_driver_manifest') return Promise.resolve(mockPostgresManifest);
        if (cmd === 'get_schemas') return Promise.resolve(mockSchemas);
        if (cmd === 'get_selected_schemas') return Promise.resolve(['public']);
        if (cmd === 'get_schema_preference') return Promise.resolve('public');
        if (cmd === 'set_window_title') return Promise.resolve(undefined);
        if (cmd === 'get_tables') return Promise.resolve(mockPgTables);
        if (cmd === 'get_views') return Promise.resolve(mockPgViews);
        if (cmd === 'get_routines') return Promise.resolve(mockPgRoutines);
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useDatabase(), { wrapper });

      await act(async () => {
        await result.current.connect('pg-conn');
      });

      await waitFor(() => {
        expect(result.current.selectedSchemas).toEqual(['public']);
      });

      await act(async () => {
        await result.current.disconnect();
      });

      expect(result.current.selectedSchemas).toEqual([]);
      expect(result.current.needsSchemaSelection).toBe(false);
    });

    it('should filter saved selection against available schemas', async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === 'get_connections') return Promise.resolve(mockPgConnections);
        if (cmd === 'test_connection') return Promise.resolve('Connection successful!');
        if (cmd === 'get_driver_manifest') return Promise.resolve(mockPostgresManifest);
        if (cmd === 'get_schemas') return Promise.resolve(['public', 'analytics']); // 'deleted_schema' not available
        if (cmd === 'get_selected_schemas') return Promise.resolve(['public', 'deleted_schema']); // saved has stale entry
        if (cmd === 'get_schema_preference') return Promise.resolve('public');
        if (cmd === 'set_window_title') return Promise.resolve(undefined);
        if (cmd === 'get_tables') return Promise.resolve(mockPgTables);
        if (cmd === 'get_views') return Promise.resolve(mockPgViews);
        if (cmd === 'get_routines') return Promise.resolve(mockPgRoutines);
        return Promise.resolve(undefined);
      });

      const { result } = renderHook(() => useDatabase(), { wrapper });

      await act(async () => {
        await result.current.connect('pg-conn');
      });

      await waitFor(() => {
        // Only 'public' should remain (deleted_schema filtered out)
        expect(result.current.selectedSchemas).toEqual(['public']);
        expect(result.current.needsSchemaSelection).toBe(false);
      });
    });
  });
});
