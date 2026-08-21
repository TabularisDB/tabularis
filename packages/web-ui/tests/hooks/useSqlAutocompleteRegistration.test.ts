import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Monaco } from '@monaco-editor/react';
import { useSqlAutocompleteRegistration } from '../../src/hooks/useSqlAutocompleteRegistration';
import { registerSqlAutocomplete } from '../../src/utils/autocomplete';
import { useDatabase } from '../../src/hooks/useDatabase';

vi.mock('../../src/hooks/useDatabase');
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

describe('useSqlAutocompleteRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('associates flat tables with the active database', () => {
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

    renderHook(() =>
      useSqlAutocompleteRegistration('conn1', { monaco }),
    );

    expect(mockRegisterSqlAutocomplete).toHaveBeenCalledWith(
      monaco,
      'conn1',
      [{ name: 'Addresses', schema: 'Ops' }],
      'Ops',
      capabilities,
    );
  });

  it('preserves each table database in multi-database mode', () => {
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

    renderHook(() =>
      useSqlAutocompleteRegistration('conn1', { monaco }),
    );

    expect(mockRegisterSqlAutocomplete).toHaveBeenCalledWith(
      monaco,
      'conn1',
      [
        { name: 'Addresses', schema: 'Ops' },
        { name: 'Addresses', schema: 'Archive' },
      ],
      'Ops',
      capabilities,
    );
  });
});
