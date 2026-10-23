import type {CommandScope} from '@/types/commands';
import type {TableTarget} from '@/types/databaseObjects';
import type {PaletteItem} from '@/types/palette';
import {createTableCountRequest, createTableConsoleRequest} from './databaseObjectActions';
import {PINNED_PALETTE_RELEVANCE} from './paletteItems';

interface BuiltInCommandLabels {
    openSettings: string;
    openConnections: string;
    newConsole: string;
    openTableInConsole: string;
    inspectTable: string;
    generateSql: string;
    countRows: string;
    navigationCategory: string;
    connectionCategory: string;
    editorCategory: string;
    tableCategory: string;
    resultCategory: string;
    toggleWordWrapEnable: string;
    toggleWordWrapDisable: string;
    copySelectedCells: (count: number) => string;
    copySelectedRows: (count: number) => string;
    copySelectedColumns: (count: number) => string;
    copyColumnValuesAsSqlIn: string;
    copyAllRows: (count?: number) => string;
}

/** Commands that open a modal the palette itself owns, rather than navigating. */
interface BuiltInCommandModals {
    inspect: (target: TableTarget) => void;
    generateSql: (target: TableTarget) => void;
}

/** Editor-scoped commands that depend on live editor state. */
interface BuiltInCommandEditorActions {
    wordWrapEnabled: boolean;
    toggleWordWrap: () => void;
}

export function createBuiltInCommandItems(
    scope: CommandScope,
    labels: BuiltInCommandLabels,
    modals: BuiltInCommandModals,
    getShortcut: (shortcutId: string) => string | undefined,
    editorActions?: BuiltInCommandEditorActions,
): PaletteItem[] {
    const items: PaletteItem[] = [
        {
            id: 'app.open-settings',
            shortcut: getShortcut('open_settings'),
            title: labels.openSettings,
            group: labels.navigationCategory,
            keywords: ['preferences', 'configuration'],
            icon: 'command',
            primaryAction: {
                id: 'app.open-settings',
                label: labels.openSettings,
                execute: () => scope.runtime.navigate('/settings'),
            },
        },
        {
            id: 'app.open-connections',
            shortcut: getShortcut('open_connections'),
            title: labels.openConnections,
            group: labels.navigationCategory,
            keywords: ['connection', 'manager', 'database'],
            icon: 'command',
            primaryAction: {
                id: 'app.open-connections',
                label: labels.openConnections,
                execute: () => scope.runtime.navigate('/connections'),
            },
        },
    ];

    if (scope.connectionId) {
        const connectionId = scope.connectionId;
        items.push({
            id: 'connection.new-console',
            shortcut: scope.getEditorCommands ? getShortcut('new_tab') : undefined,
            title: labels.newConsole,
            group: labels.editorCategory,
            keywords: ['sql', 'query', 'console', 'editor'],
            icon: 'new-console',
            primaryAction: {
                id: 'connection.new-console',
                label: labels.newConsole,
                execute: () =>
                    scope.runtime.openEditor({
                        kind: 'console',
                        initialQuery: '',
                        preventAutoRun: true,
                        ...(scope.table?.schema ? {schema: scope.table.schema} : {}),
                        targetConnectionId: connectionId,
                    }),
            },
        });
    }

    if (editorActions) {
        const label = editorActions.wordWrapEnabled
            ? labels.toggleWordWrapDisable
            : labels.toggleWordWrapEnable;
        items.push({
            id: 'editor.toggle-word-wrap',
            title: label,
            group: labels.editorCategory,
            keywords: ['wrap', 'line', 'editor'],
            icon: 'command',
            primaryAction: {
                id: 'editor.toggle-word-wrap',
                label,
                execute: editorActions.toggleWordWrap,
            },
        });
    }

    if (scope.table) {
        const table = scope.table;

        items.push(
            {
                id: 'table.open-in-console',
                title: labels.openTableInConsole,
                description: table.tableName,
                group: labels.tableCategory,
                keywords: ['sql', 'query', 'console'],
                icon: 'command',
                relevance: PINNED_PALETTE_RELEVANCE,
                primaryAction: {
                    id: 'table.open-in-console',
                    label: labels.openTableInConsole,
                    execute: () =>
                        scope.runtime.openEditor(
                            createTableConsoleRequest(
                                {
                                    connectionId: table.connectionId,
                                    objectName: table.tableName,
                                    schema: table.schema,
                                },
                                scope.driver,
                            ),
                        ),
                },
            },
            {
                id: 'table.inspect',
                title: labels.inspectTable,
                description: table.tableName,
                group: labels.tableCategory,
                keywords: ['schema', 'structure', 'columns'],
                icon: 'inspect',
                relevance: PINNED_PALETTE_RELEVANCE,
                primaryAction: {
                    id: 'table.inspect',
                    label: labels.inspectTable,
                    execute: () => modals.inspect(table),
                },
            },
            {
                id: 'table.generate-sql',
                title: labels.generateSql,
                description: table.tableName,
                group: labels.tableCategory,
                keywords: ['ddl', 'insert', 'update', 'template'],
                icon: 'generate-sql',
                relevance: PINNED_PALETTE_RELEVANCE,
                primaryAction: {
                    id: 'table.generate-sql',
                    label: labels.generateSql,
                    execute: () => modals.generateSql(table),
                },
            },
            {
                id: 'table.count-rows',
                title: labels.countRows,
                description: table.tableName,
                group: labels.tableCategory,
                keywords: ['count', 'rows', 'total'],
                icon: 'count',
                relevance: PINNED_PALETTE_RELEVANCE,
                primaryAction: {
                    id: 'table.count-rows',
                    label: labels.countRows,
                    execute: () =>
                        scope.runtime.openEditor(
                            createTableCountRequest(
                                {
                                    connectionId: table.connectionId,
                                    objectName: table.tableName,
                                    schema: table.schema,
                                },
                                scope.driver,
                            ),
                        ),
                },
            },
        );
    }

    const editorCommands = scope.getEditorCommands?.();
    const addEditorCommand = (
        id: string,
        command: {label: string; execute: () => void | Promise<void>},
        keywords: string[],
        shortcutId?: string,
    ) => {
        items.push({
            id,
            title: command.label,
            shortcut: shortcutId ? getShortcut(shortcutId) : undefined,
            group: labels.editorCategory,
            keywords,
            icon: 'command',
            relevance: PINNED_PALETTE_RELEVANCE,
            primaryAction: {
                id,
                label: command.label,
                execute: command.execute,
            },
        });
    };

    if (editorCommands?.run) {
        addEditorCommand(
            'editor.run',
            editorCommands.run,
            ['run', 'execute', 'query', 'selection', 'statement'],
            'run_query_editor',
        );
    }
    if (editorCommands?.runAll) {
        addEditorCommand(
            'editor.run-all',
            editorCommands.runAll,
            ['run', 'execute', 'query', 'all', 'statements'],
            'run_all_editor',
        );
    }
    if (editorCommands?.saveSqlFile) {
        addEditorCommand('editor.save-sql-file', editorCommands.saveSqlFile, [
            'save',
            'sql',
            'file',
        ]);
    }
    if (editorCommands?.closeTab) {
        addEditorCommand(
            'tab.close-active',
            editorCommands.closeTab,
            ['close', 'tab', 'editor'],
            'close_tab',
        );
    }

    if (editorCommands?.aiGenerate) {
        addEditorCommand('editor.ai-generate', editorCommands.aiGenerate, [
            'ai',
            'generate',
            'sql',
            'prompt',
        ]);
    }
    if (editorCommands?.aiExplain) {
        addEditorCommand('editor.ai-explain', editorCommands.aiExplain, ['ai', 'explain', 'query']);
    }

    const resultCommands = scope.getResultCommands?.();
    const addResultCommand = (
        id: string,
        title: string,
        execute: () => void | Promise<void>,
        description?: string,
        shortcutId?: string,
    ) => {
        items.push({
            id,
            title,
            description,
            shortcut: shortcutId ? getShortcut(shortcutId) : undefined,
            group: labels.resultCategory,
            keywords: ['copy', 'clipboard', 'result', 'selection'],
            icon: 'copy',
            relevance: PINNED_PALETTE_RELEVANCE,
            primaryAction: {id, label: title, execute},
        });
    };

    if (resultCommands?.copySelectedCells) {
        const command = resultCommands.copySelectedCells;
        addResultCommand(
            'result.copy-selected-cells',
            labels.copySelectedCells(command.count),
            command.execute,
            undefined,
            'copy_selection',
        );
    }
    if (resultCommands?.copySelectedRows) {
        const command = resultCommands.copySelectedRows;
        addResultCommand(
            'result.copy-selected-rows',
            labels.copySelectedRows(command.count),
            command.execute,
        );
    }
    if (resultCommands?.copySelectedColumns) {
        const command = resultCommands.copySelectedColumns;
        addResultCommand(
            'result.copy-selected-columns',
            labels.copySelectedColumns(command.count),
            command.execute,
        );
    }
    if (resultCommands?.copyColumnValuesAsSqlIn) {
        const command = resultCommands.copyColumnValuesAsSqlIn;
        addResultCommand(
            'result.copy-column-values-as-sql-in',
            labels.copyColumnValuesAsSqlIn,
            command.execute,
            command.columnName,
        );
    }
    if (resultCommands?.copyAllRows) {
        const command = resultCommands.copyAllRows;
        addResultCommand(
            'result.copy-all-rows',
            labels.copyAllRows(command.count),
            command.execute,
        );
    }

    return items;
}
