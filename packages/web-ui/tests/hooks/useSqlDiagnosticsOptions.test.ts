import {renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import React from 'react';
import {DEFAULT_SETTINGS, SettingsContext, type Settings} from '@/contexts/SettingsContext';
import {useSqlDiagnosticsOptions} from '@/hooks/useSqlDiagnosticsOptions';
import {useDatabase} from '@/hooks/useDatabase';
import {getTableColumns} from '@/utils/autocomplete';
import {SQL_DIAGNOSTICS_COLUMNS_MAX_AGE_MS} from '@/hooks/useSqlDiagnostics';

const clientMock = vi.hoisted(() => ({call: vi.fn()}));

vi.mock('@/hooks/useDatabase');
vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => clientMock,
}));
vi.mock('@/utils/autocomplete', () => ({
    getTableColumns: vi.fn(),
}));

const mockUseDatabase = vi.mocked(useDatabase);
const mockGetTableColumns = vi.mocked(getTableColumns);

const capabilities = {
    schemas: true,
    file_based: false,
    folder_based: false,
    single_database: false,
    no_connection_required: false,
};

const settingsWrapperFor = (overrides: Partial<Settings>) =>
    function SettingsWrapper({children}: {children: React.ReactNode}) {
        return React.createElement(
            SettingsContext.Provider,
            {
                value: {
                    settings: {...DEFAULT_SETTINGS, ...overrides},
                    updateSetting: vi.fn().mockResolvedValue(undefined),
                    isLoading: false,
                    isLanguageReady: true,
                    isLanguageSettled: true,
                },
            },
            children,
        );
    };

function mockDatabase(overrides: Record<string, unknown> = {}) {
    mockUseDatabase.mockReturnValue({
        tables: [{name: 'orders'}],
        views: [{name: 'order_totals'}],
        materializedViews: [],
        isLoadingTables: false,
        isLoadingViews: false,
        activeDriver: 'postgres',
        activeSchema: 'public',
        activeCapabilities: capabilities,
        activeDatabaseName: 'app',
        schemaDataMap: {},
        nestedDatabaseDataMap: {},
        selectedDatabases: [],
        ...overrides,
    } as unknown as ReturnType<typeof useDatabase>);
}

describe('useSqlDiagnosticsOptions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetTableColumns.mockResolvedValue([{label: 'id', detail: 'int4'}]);
        mockDatabase();
    });

    it('is off until the setting is turned on', () => {
        const {result} = renderHook(() => useSqlDiagnosticsOptions('conn-1'), {
            wrapper: settingsWrapperFor({}),
        });
        expect(result.current).toBeUndefined();
    });

    it('is off for drivers other than PostgreSQL', () => {
        mockDatabase({activeDriver: 'mysql'});
        const {result} = renderHook(() => useSqlDiagnosticsOptions('conn-1'), {
            wrapper: settingsWrapperFor({sqlDiagnosticsEnabled: true}),
        });
        expect(result.current).toBeUndefined();
    });

    it('is off without a connection or when the editor is not eligible', () => {
        const wrapper = settingsWrapperFor({sqlDiagnosticsEnabled: true});
        expect(
            renderHook(() => useSqlDiagnosticsOptions(null), {wrapper}).result.current,
        ).toBeUndefined();
        expect(
            renderHook(() => useSqlDiagnosticsOptions('conn-1', {enabled: false}), {wrapper}).result
                .current,
        ).toBeUndefined();
    });

    it('resolves against the loaded active-schema listing, views included', async () => {
        const {result} = renderHook(() => useSqlDiagnosticsOptions('conn-1'), {
            wrapper: settingsWrapperFor({sqlDiagnosticsEnabled: true}),
        });
        const resolve = result.current?.resolveRelation;
        expect(resolve).toBeDefined();

        expect(await resolve?.({name: 'orders'})).toEqual({status: 'found', columns: ['id']});
        expect(mockGetTableColumns).toHaveBeenCalledWith(
            clientMock,
            'conn-1',
            'orders',
            'public',
            null,
            SQL_DIAGNOSTICS_COLUMNS_MAX_AGE_MS,
        );
        expect(await resolve?.({name: 'order_totals'})).toEqual({status: 'found', columns: ['id']});
        expect(await resolve?.({name: 'ghost'})).toEqual({status: 'missing'});
    });

    it('treats an empty active-schema listing as not loaded', async () => {
        mockDatabase({tables: [], views: []});
        mockGetTableColumns.mockResolvedValue([]);
        const {result} = renderHook(() => useSqlDiagnosticsOptions('conn-1'), {
            wrapper: settingsWrapperFor({sqlDiagnosticsEnabled: true}),
        });
        expect(await result.current?.resolveRelation({name: 'orders'})).toEqual({
            status: 'unknown',
        });
    });

    it('puts the tab schema ahead of public on the search path', async () => {
        mockDatabase({
            schemaDataMap: {
                sales: {tables: [{name: 'invoices'}], views: [], isLoaded: true, isLoading: false},
            },
        });
        const {result} = renderHook(() => useSqlDiagnosticsOptions('conn-1', {schema: 'sales'}), {
            wrapper: settingsWrapperFor({sqlDiagnosticsEnabled: true}),
        });
        await result.current?.resolveRelation({name: 'invoices'});
        expect(mockGetTableColumns).toHaveBeenCalledWith(
            clientMock,
            'conn-1',
            'invoices',
            'sales',
            null,
            SQL_DIAGNOSTICS_COLUMNS_MAX_AGE_MS,
        );
    });

    it('reads a nested multi-database layout from the tab database', async () => {
        mockDatabase({
            activeCapabilities: {...capabilities, schemas: true},
            selectedDatabases: ['app', 'analytics'],
            nestedDatabaseDataMap: {
                analytics: {
                    schemaDataMap: {
                        public: {
                            tables: [{name: 'events'}],
                            views: [],
                            isLoaded: true,
                            isLoading: false,
                        },
                    },
                },
            },
        });
        const {result} = renderHook(
            () => useSqlDiagnosticsOptions('conn-1', {schema: 'public', database: 'analytics'}),
            {wrapper: settingsWrapperFor({sqlDiagnosticsEnabled: true})},
        );
        const resolve = result.current?.resolveRelation;
        expect(await resolve?.({name: 'events'})).toEqual({status: 'found', columns: ['id']});
        expect(mockGetTableColumns).toHaveBeenCalledWith(
            clientMock,
            'conn-1',
            'events',
            'public',
            'analytics',
            SQL_DIAGNOSTICS_COLUMNS_MAX_AGE_MS,
        );
        expect(await resolve?.({name: 'orders'})).toEqual({status: 'missing'});
    });

    it('keys the context by connection, database and schema', () => {
        const wrapper = settingsWrapperFor({sqlDiagnosticsEnabled: true});
        const {result} = renderHook(() => useSqlDiagnosticsOptions('conn-1', {schema: 'sales'}), {
            wrapper,
        });
        expect(result.current?.contextKey).toBe(JSON.stringify(['conn-1', null, 'sales']));
    });

    it('keeps the same options while nothing relevant changes', () => {
        const wrapper = settingsWrapperFor({sqlDiagnosticsEnabled: true});
        const {result, rerender} = renderHook(() => useSqlDiagnosticsOptions('conn-1'), {wrapper});
        const first = result.current;
        rerender();
        expect(result.current).toBe(first);
    });
});
