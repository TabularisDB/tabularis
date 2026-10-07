import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Monaco } from '@monaco-editor/react';
import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SettingsProvider } from '../../src/contexts/SettingsProvider';
import { useSqlAutocompleteRegistration } from '../../src/hooks/useSqlAutocompleteRegistration';
import { registerSqlAutocomplete } from '../../src/utils/autocomplete';
import { useDatabase } from '../../src/hooks/useDatabase';

vi.mock('../../src/hooks/useDatabase');
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock('../../src/utils/autocomplete', () => ({
  registerSqlAutocomplete: vi.fn(),
  disposeSqlAutocomplete: vi.fn(),
}));

const capabilities = {
  schemas: false,
  file_based: false,
  folder_based: false,
  single_database: false,
  no_connection_required: false,
};

const monaco = {} as Monaco;
const mockUseDatabase = vi.mocked(useDatabase);
const mockRegisterSqlAutocomplete = vi.mocked(registerSqlAutocomplete);
const settingsWrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(SettingsProvider, null, children);

describe('useSqlAutocompleteRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'get_config') {
        return Promise.resolve({
          language: 'en',
          autocompleteKeywordCase: 'upper',
        });
      }
      return Promise.resolve(undefined);
    });
  });

  it('associates flat tables with the active database', async () => {
    mockUseDatabase.mockReturnValue({
      tables: [{ name: 'Addresses' }],
      activeDriver: 'mysql',
      activeSchema: null,
      activeDatabaseName: 'Ops',
      activeCapabilities: capabilities,
      schemaDataMap: {},
      databaseDataMap: {},
      selectedDatabases: [],
    } as ReturnType<typeof useDatabase>);

    renderHook(() => useSqlAutocompleteRegistration('conn1', { monaco }), {
      wrapper: settingsWrapper,
    });

    await waitFor(() => {
      expect(mockRegisterSqlAutocomplete).toHaveBeenLastCalledWith(
        monaco,
        'conn1',
        [{ name: 'Addresses', schema: 'Ops' }],
        'Ops',
        capabilities,
        'upper',
      );
    });
  });

  it('preserves each table database in multi-database mode', async () => {
    mockUseDatabase.mockReturnValue({
      tables: [],
      activeDriver: 'mysql',
      activeSchema: null,
      activeDatabaseName: 'Ops',
      activeCapabilities: capabilities,
      schemaDataMap: {},
      databaseDataMap: {
        Ops: { tables: [{ name: 'Addresses' }] },
        Archive: { tables: [{ name: 'Addresses' }] },
      },
      selectedDatabases: ['Ops', 'Archive'],
    } as ReturnType<typeof useDatabase>);

    renderHook(() => useSqlAutocompleteRegistration('conn1', { monaco }), {
      wrapper: settingsWrapper,
    });

    await waitFor(() => {
      expect(mockRegisterSqlAutocomplete).toHaveBeenLastCalledWith(
        monaco,
        'conn1',
        [
          { name: 'Addresses', schema: 'Ops' },
          { name: 'Addresses', schema: 'Archive' },
        ],
        'Ops',
        capabilities,
        'upper',
      );
    });
  });
});
