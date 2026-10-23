import {renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {Monaco} from '@monaco-editor/react';
import React from 'react';
import {DEFAULT_SETTINGS, SettingsContext, type Settings} from '@/contexts/SettingsContext';
import {useSqlAutocompleteRegistration} from '@/hooks/useSqlAutocompleteRegistration';
import {registerSqlAutocomplete} from '@/utils/autocomplete';
import {useDatabase} from '@/hooks/useDatabase';

const clientMock = vi.hoisted(() => ({call: vi.fn()}));

vi.mock('@/hooks/useDatabase');
vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => clientMock,
}));
vi.mock('@/utils/autocomplete', () => ({
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

// A plain provider with a fixed value is enough: the hook only reads
// `settings`. `getSettings` is called on every render so a test can change
// the value and `rerender()`.
const createSettingsWrapper = (getSettings: () => Settings) =>
    function SettingsWrapper({children}: {children: React.ReactNode}) {
        return React.createElement(
            SettingsContext.Provider,
            {
                value: {
                    settings: getSettings(),
                    updateSetting: vi.fn().mockResolvedValue(undefined),
                    isLoading: false,
                    isLanguageReady: true,
                    isLanguageSettled: true,
                },
            },
            children,
        );
    };

const settingsWrapperFor = (overrides: Partial<Settings> = {}) =>
    createSettingsWrapper(() => ({...DEFAULT_SETTINGS, ...overrides}));

describe('useSqlAutocompleteRegistration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('associates flat tables with the active database', () => {
        mockUseDatabase.mockReturnValue({
            tables: [{name: 'Addresses'}],
            activeDriver: 'mysql',
            activeSchema: null,
            activeDatabaseName: 'Ops',
            activeCapabilities: capabilities,
            schemaDataMap: {},
            databaseDataMap: {},
            selectedDatabases: [],
        } as ReturnType<typeof useDatabase>);

        renderHook(() => useSqlAutocompleteRegistration('conn1', {monaco}), {
            wrapper: settingsWrapperFor({autocompleteKeywordCase: 'upper'}),
        });

        expect(mockRegisterSqlAutocomplete).toHaveBeenLastCalledWith(
            monaco,
            'conn1',
            [{name: 'Addresses', schema: 'Ops'}],
            'Ops',
            capabilities,
            expect.any(Object),
            'upper',
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
                Ops: {tables: [{name: 'Addresses'}]},
                Archive: {tables: [{name: 'Addresses'}]},
            },
            selectedDatabases: ['Ops', 'Archive'],
        } as ReturnType<typeof useDatabase>);

        renderHook(() => useSqlAutocompleteRegistration('conn1', {monaco}), {
            wrapper: settingsWrapperFor({autocompleteKeywordCase: 'upper'}),
        });

        expect(mockRegisterSqlAutocomplete).toHaveBeenLastCalledWith(
            monaco,
            'conn1',
            [
                {name: 'Addresses', schema: 'Ops'},
                {name: 'Addresses', schema: 'Archive'},
            ],
            'Ops',
            capabilities,
            expect.any(Object),
            'upper',
        );
    });

    describe('keyword case setting', () => {
        beforeEach(() => {
            mockUseDatabase.mockReturnValue({
                tables: [{name: 'Addresses'}],
                activeDriver: 'mysql',
                activeSchema: null,
                activeDatabaseName: 'Ops',
                activeCapabilities: capabilities,
                schemaDataMap: {},
                databaseDataMap: {},
                selectedDatabases: [],
            } as ReturnType<typeof useDatabase>);
        });

        const lastKeywordCase = () => mockRegisterSqlAutocomplete.mock.calls.at(-1)?.[6];

        it('passes the default setting (match) to the provider', () => {
            renderHook(() => useSqlAutocompleteRegistration('conn1', {monaco}), {
                wrapper: settingsWrapperFor(),
            });

            expect(lastKeywordCase()).toBe('match');
        });

        it('passes a forced setting to the provider', () => {
            renderHook(() => useSqlAutocompleteRegistration('conn1', {monaco}), {
                wrapper: settingsWrapperFor({autocompleteKeywordCase: 'lower'}),
            });

            expect(lastKeywordCase()).toBe('lower');
        });

        it('re-registers with the new value when the setting changes, without a remount', () => {
            let settings: Settings = {...DEFAULT_SETTINGS, autocompleteKeywordCase: 'upper'};
            const {rerender} = renderHook(() => useSqlAutocompleteRegistration('conn1', {monaco}), {
                wrapper: createSettingsWrapper(() => settings),
            });
            expect(lastKeywordCase()).toBe('upper');
            const callsBefore = mockRegisterSqlAutocomplete.mock.calls.length;

            settings = {...settings, autocompleteKeywordCase: 'lower'};
            rerender();

            expect(mockRegisterSqlAutocomplete.mock.calls.length).toBe(callsBefore + 1);
            expect(lastKeywordCase()).toBe('lower');
        });

        it('does not re-register when an unrelated setting changes', () => {
            let settings: Settings = {...DEFAULT_SETTINGS};
            const {rerender} = renderHook(() => useSqlAutocompleteRegistration('conn1', {monaco}), {
                wrapper: createSettingsWrapper(() => settings),
            });
            const callsBefore = mockRegisterSqlAutocomplete.mock.calls.length;

            settings = {...settings, fontSize: 18};
            rerender();

            expect(mockRegisterSqlAutocomplete.mock.calls.length).toBe(callsBefore);
        });
    });
});
