import {describe, expect, it, vi} from 'vitest';

import {createBuiltInCommandItems} from '@/utils/builtInCommands';
import shortcutDefs from '@/config/shortcuts.json';
import {formatShortcut, type ShortcutDef} from '@/utils/keybindings';
import type {CommandScope} from '@/types/commands';

const labels = {
    openSettings: 'Open settings',
    openConnections: 'Open connection manager',
    newConsole: 'New console',
    openTableInConsole: 'Open table in console',
    inspectTable: 'Inspect structure',
    generateSql: 'Generate SQL templates',
    countRows: 'Count rows',
    navigationCategory: 'Navigation',
    connectionCategory: 'Connection',
    editorCategory: 'Editor',
    tableCategory: 'Table',
    resultCategory: 'Results',
    copySelectedCells: (count: number) => `Copy ${count} cells`,
    copySelectedRows: (count: number) => `Copy ${count} rows`,
    copySelectedColumns: (count: number) => `Copy ${count} columns`,
    copyColumnValuesAsSqlIn: 'Copy column values as SQL IN',
    copyAllRows: (count?: number) => `Copy all ${count ?? 'unknown'} rows`,
    toggleWordWrapEnable: 'Enable word wrap',
    toggleWordWrapDisable: 'Disable word wrap',
};

const getShortcut = (id: string) => `Shortcut for ${id}`;

const findItem = (items: ReturnType<typeof createBuiltInCommandItems>, id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`Missing command: ${id}`);
    return item;
};

describe('createBuiltInCommandItems', () => {
    const createScope = (overrides: Partial<CommandScope> = {}): CommandScope => ({
        connectionId: 'connection-b',
        driver: 'postgres',
        table: {
            connectionId: 'connection-b',
            tableName: 'orders',
            schema: 'sales',
        },
        runtime: {
            navigate: vi.fn(),
            openEditor: vi.fn(),
        },
        ...overrides,
    });

    const modals = () => ({
        inspect: vi.fn(),
        generateSql: vi.fn(),
    });

    it('should return commands already bound to their scope', async () => {
        const scope = createScope();
        const items = createBuiltInCommandItems(scope, labels, modals(), getShortcut);

        const consoleCommand = findItem(items, 'table.open-in-console');
        expect(findItem(items, 'app.open-settings').shortcut).toBe('Shortcut for open_settings');
        expect(findItem(items, 'app.open-connections').shortcut).toBe(
            'Shortcut for open_connections',
        );
        expect(consoleCommand.shortcut).toBeUndefined();
        expect(consoleCommand.description).toBe('orders');
        await consoleCommand.primaryAction.execute();
        expect(scope.runtime.openEditor).toHaveBeenCalledWith({
            kind: 'console',
            initialQuery: 'SELECT * FROM "sales"."orders"',
            queryName: 'orders',
            preventAutoRun: true,
            schema: 'sales',
            targetConnectionId: 'connection-b',
        });
    });

    it('should navigate to the connection manager', async () => {
        const scope = createScope();
        const items = createBuiltInCommandItems(scope, labels, modals(), getShortcut);

        await findItem(items, 'app.open-connections').primaryAction.execute();
        expect(scope.runtime.navigate).toHaveBeenCalledWith('/connections');
    });

    it('should open an empty console on the schema the user is looking at', async () => {
        const scope = createScope();
        const items = createBuiltInCommandItems(scope, labels, modals(), getShortcut);
        const command = findItem(items, 'connection.new-console');

        expect(command.shortcut).toBeUndefined();
        expect(command.group).toBe('Editor');
        await command.primaryAction.execute();
        expect(scope.runtime.openEditor).toHaveBeenCalledWith({
            kind: 'console',
            initialQuery: '',
            preventAutoRun: true,
            schema: 'sales',
            targetConnectionId: 'connection-b',
        });
    });

    it('should count the rows of the current table', async () => {
        const scope = createScope();
        const items = createBuiltInCommandItems(scope, labels, modals(), getShortcut);

        await findItem(items, 'table.count-rows').primaryAction.execute();
        expect(scope.runtime.openEditor).toHaveBeenCalledWith({
            kind: 'console',
            initialQuery: 'SELECT COUNT(*) as count FROM "sales"."orders"',
            schema: 'sales',
            targetConnectionId: 'connection-b',
        });
    });

    it('should hand the current table to the palette modals', async () => {
        const scope = createScope();
        const paletteModals = modals();
        const items = createBuiltInCommandItems(scope, labels, paletteModals, getShortcut);

        await findItem(items, 'table.inspect').primaryAction.execute();
        await findItem(items, 'table.generate-sql').primaryAction.execute();

        expect(paletteModals.inspect).toHaveBeenCalledWith(scope.table);
        expect(paletteModals.generateSql).toHaveBeenCalledWith(scope.table);
    });

    it('should omit contextual commands outside their context', () => {
        const items = createBuiltInCommandItems(
            createScope({connectionId: null, driver: null, table: null}),
            labels,
            modals(),
            getShortcut,
        );

        expect(items.map((item) => item.id)).toEqual(['app.open-settings', 'app.open-connections']);
    });

    it('should offer connection commands without a table in scope', () => {
        const items = createBuiltInCommandItems(
            createScope({table: null}),
            labels,
            modals(),
            getShortcut,
        );

        expect(items.map((item) => item.id)).toEqual([
            'app.open-settings',
            'app.open-connections',
            'connection.new-console',
        ]);
    });

    it('should add only the result actions available in the active grid', async () => {
        const copySelectedCells = vi.fn();
        const copySelectedRows = vi.fn();
        const copySelectedColumns = vi.fn();
        const copyColumnValuesAsSqlIn = vi.fn();
        const copyAllRows = vi.fn();
        const scope = createScope({
            getResultCommands: () => ({
                copySelectedCells: {count: 4, execute: copySelectedCells},
                copySelectedRows: {count: 2, execute: copySelectedRows},
                copySelectedColumns: {count: 1, execute: copySelectedColumns},
                copyColumnValuesAsSqlIn: {
                    count: 2,
                    columnName: 'status',
                    execute: copyColumnValuesAsSqlIn,
                },
                copyAllRows: {count: 12, execute: copyAllRows},
            }),
        });

        const items = createBuiltInCommandItems(scope, labels, modals(), getShortcut);
        expect(findItem(items, 'result.copy-selected-cells').shortcut).toBe(
            'Shortcut for copy_selection',
        );
        expect(findItem(items, 'result.copy-selected-rows').shortcut).toBeUndefined();
        const resultItems = items.filter((item) => item.group === 'Results');

        expect(resultItems.map((item) => [item.id, item.title])).toEqual([
            ['result.copy-selected-cells', 'Copy 4 cells'],
            ['result.copy-selected-rows', 'Copy 2 rows'],
            ['result.copy-selected-columns', 'Copy 1 columns'],
            ['result.copy-column-values-as-sql-in', 'Copy column values as SQL IN'],
            ['result.copy-all-rows', 'Copy all 12 rows'],
        ]);
        expect(findItem(items, 'result.copy-column-values-as-sql-in').description).toBe('status');
        await findItem(items, 'result.copy-selected-cells').primaryAction.execute();
        await findItem(items, 'result.copy-selected-rows').primaryAction.execute();
        await findItem(items, 'result.copy-selected-columns').primaryAction.execute();
        await findItem(items, 'result.copy-column-values-as-sql-in').primaryAction.execute();
        await findItem(items, 'result.copy-all-rows').primaryAction.execute();
        expect(copySelectedCells).toHaveBeenCalledOnce();
        expect(copySelectedRows).toHaveBeenCalledOnce();
        expect(copySelectedColumns).toHaveBeenCalledOnce();
        expect(copyColumnValuesAsSqlIn).toHaveBeenCalledOnce();
        expect(copyAllRows).toHaveBeenCalledOnce();
    });

    it('should resolve result actions when the palette opens', () => {
        const getResultCommands = vi.fn(() => null);
        const scope = createScope({getResultCommands});

        createBuiltInCommandItems(scope, labels, modals(), getShortcut);

        expect(getResultCommands).toHaveBeenCalledOnce();
    });

    it('should group available editor actions with new console', async () => {
        const run = vi.fn();
        const runAll = vi.fn();
        const saveSqlFile = vi.fn();
        const closeTab = vi.fn();
        const scope = createScope({
            getEditorCommands: () => ({
                run: {label: 'Run statement', execute: run},
                runAll: {label: 'Run all', execute: runAll},
                saveSqlFile: {label: 'Save SQL file', execute: saveSqlFile},
                closeTab: {label: 'Close tab', execute: closeTab},
            }),
        });

        const items = createBuiltInCommandItems(scope, labels, modals(), getShortcut);
        expect(findItem(items, 'connection.new-console').shortcut).toBe('Shortcut for new_tab');
        expect(findItem(items, 'editor.run').shortcut).toBe('Shortcut for run_query_editor');
        expect(findItem(items, 'editor.run-all').shortcut).toBe('Shortcut for run_all_editor');
        expect(findItem(items, 'tab.close-active').shortcut).toBe('Shortcut for close_tab');
        expect(findItem(items, 'editor.save-sql-file').shortcut).toBeUndefined();
        const editorItems = items.filter((item) => item.group === 'Editor');

        expect(editorItems.map((item) => [item.id, item.title])).toEqual([
            ['connection.new-console', 'New console'],
            ['editor.run', 'Run statement'],
            ['editor.run-all', 'Run all'],
            ['editor.save-sql-file', 'Save SQL file'],
            ['tab.close-active', 'Close tab'],
        ]);

        for (const item of editorItems) {
            await item.primaryAction.execute();
        }
        expect(run).toHaveBeenCalledOnce();
        expect(runAll).toHaveBeenCalledOnce();
        expect(saveSqlFile).toHaveBeenCalledOnce();
        expect(closeTab).toHaveBeenCalledOnce();
    });

    it('should expose a word wrap toggle in the editor group', () => {
        const toggleWordWrap = vi.fn();
        const scope = createScope();
        const items = createBuiltInCommandItems(scope, labels, modals(), getShortcut, {
            wordWrapEnabled: true,
            toggleWordWrap,
        });

        const item = findItem(items, 'editor.toggle-word-wrap');
        expect(item.group).toBe('Editor');
        expect(item.keywords).toEqual(expect.arrayContaining(['wrap', 'line', 'editor']));
    });

    it('should label the word wrap toggle with the opposite of the current state', async () => {
        const toggleWordWrap = vi.fn();
        const scope = createScope();

        const enabled = createBuiltInCommandItems(scope, labels, modals(), getShortcut, {
            wordWrapEnabled: true,
            toggleWordWrap,
        });
        expect(findItem(enabled, 'editor.toggle-word-wrap').title).toBe('Disable word wrap');

        const disabled = createBuiltInCommandItems(scope, labels, modals(), getShortcut, {
            wordWrapEnabled: false,
            toggleWordWrap,
        });
        expect(findItem(disabled, 'editor.toggle-word-wrap').title).toBe('Enable word wrap');
    });

    it('should run the word wrap toggle action', async () => {
        const toggleWordWrap = vi.fn();
        const scope = createScope();
        const items = createBuiltInCommandItems(scope, labels, modals(), getShortcut, {
            wordWrapEnabled: false,
            toggleWordWrap,
        });

        await findItem(items, 'editor.toggle-word-wrap').primaryAction.execute();
        expect(toggleWordWrap).toHaveBeenCalledOnce();
    });

    it('should omit the word wrap toggle when editor actions are not provided', () => {
        const scope = createScope();
        const items = createBuiltInCommandItems(scope, labels, modals(), getShortcut);

        expect(items.find((item) => item.id === 'editor.toggle-word-wrap')).toBeUndefined();
    });

    it('resolves all seven mapped shortcuts from the real definitions', () => {
        const execute = vi.fn();
        const scope = createScope({
            getEditorCommands: () => ({
                run: {label: 'Run statement', execute},
                runAll: {label: 'Run all', execute},
                closeTab: {label: 'Close tab', execute},
            }),
            getResultCommands: () => ({
                copySelectedCells: {count: 1, execute},
            }),
        });
        const getConfiguredShortcut = (id: string) => {
            const def = (shortcutDefs as ShortcutDef[]).find((shortcut) => shortcut.id === id);
            return def ? formatShortcut(def, {}, true) : undefined;
        };
        const items = createBuiltInCommandItems(scope, labels, modals(), getConfiguredShortcut);

        for (const id of [
            'app.open-settings',
            'app.open-connections',
            'tab.close-active',
            'connection.new-console',
            'editor.run',
            'editor.run-all',
            'result.copy-selected-cells',
        ]) {
            expect(findItem(items, id).shortcut, id).toEqual(expect.stringMatching(/\S/));
        }
    });
});
