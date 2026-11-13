import type {ComponentProps} from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {save} from '@tauri-apps/plugin-dialog';
import {writeFile} from '@tauri-apps/plugin-fs';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NotebookView} from '@/components/notebook/NotebookView';
import type {NotebookCellWrapper} from '@/components/notebook/NotebookCellWrapper';
import type {NotebookToolbar} from '@/components/notebook/NotebookToolbar';
import {SqlEditorWrapper} from '@/components/ui/SqlEditorWrapper';
import {DEFAULT_SETTINGS, SettingsContext} from '@/contexts/SettingsContext';
import type {Tab} from '@/types/editor';
import type {NotebookState} from '@/types/notebook';

// The real SQL editor wrapper (and its 300 ms change debounce) runs here; only
// Monaco itself is replaced by a textarea.
vi.mock('@/hooks/useTabularisClient', () => import('../../support/tauriBackedHooks'));
vi.mock('@/hooks/usePlatformCapabilities', () => import('../../support/tauriBackedHooks'));
const fixtures = vi.hoisted(() => ({
    notebooks: new Map<string, NotebookState>(),
    showAlert: vi.fn(),
}));

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({
        activeDriver: 'sqlite',
        activeSchema: null,
        activeCapabilities: null,
        selectedDatabases: [],
    }),
}));
vi.mock('@/hooks/useAlert', () => ({useAlert: () => ({showAlert: fixtures.showAlert})}));
vi.mock('@/hooks/useKeybindings', () => ({
    useKeybindings: () => ({matchesShortcut: () => false}),
}));
vi.mock('@/hooks/useQueryGuards', () => ({
    useQueryGuards: () => ({pending: null, guardQuery: vi.fn(), resolve: vi.fn()}),
}));
vi.mock('@/hooks/useSqlAutocompleteRegistration', () => ({
    useSqlAutocompleteRegistration: vi.fn(),
}));
vi.mock('@/hooks/useTheme', () => ({
    useTheme: vi.fn(() => ({currentTheme: {id: 'tabularis-dark'}})),
}));
vi.mock('@/themes/themeUtils', () => ({loadMonacoTheme: vi.fn()}));
vi.mock('@/utils/sqlFolding', () => ({
    registerSqlFoldingProvider: vi.fn(),
    setSqlFoldingDialect: vi.fn(),
}));
vi.mock('@/utils/sqlFoldPreview', () => ({installSqlFoldPreview: vi.fn()}));
vi.mock('monaco-editor', () => ({KeyMod: {CtrlCmd: 2048}, KeyCode: {Enter: 3}}));
vi.mock('@/components/ui/LazyMonaco', () => ({
    MonacoEditor: ({
        onChange,
        defaultValue,
    }: {
        onChange?: (value: string) => void;
        defaultValue?: string;
    }) => (
        <textarea
            aria-label="SQL editor"
            defaultValue={defaultValue}
            onChange={(event) => onChange?.(event.target.value)}
        />
    ),
}));
vi.mock('@/utils/notebookStore', () => ({
    getNotebookState: vi.fn((id: string) => fixtures.notebooks.get(id)),
    setNotebookState: vi.fn((id: string, state: NotebookState) => {
        fixtures.notebooks.set(id, state);
    }),
    loadNotebook: vi.fn(),
    setNotebookTitle: vi.fn(),
    createNotebookFromState: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({invoke: vi.fn(), isTauri: () => true}));
vi.mock('@tauri-apps/plugin-dialog', () => ({save: vi.fn(), open: vi.fn()}));
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeTextFile: vi.fn(),
    readTextFile: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
}));
vi.mock('@/components/modals/ConfirmModal', () => ({ConfirmModal: () => null}));
vi.mock('@/components/notebook/NotebookHistoryPanel', () => ({NotebookHistoryPanel: () => null}));
vi.mock('@/components/notebook/AddCellButton', () => ({AddCellButton: () => null}));
vi.mock('@/components/notebook/RunAllSummary', () => ({RunAllSummary: () => null}));
vi.mock('@/components/notebook/ParamsPanel', () => ({ParamsPanel: () => null}));
vi.mock('@/components/notebook/NotebookOutline', () => ({NotebookOutline: () => null}));
vi.mock('@/components/notebook/NotebookToolbar', () => ({
    NotebookToolbar: ({
        onExport,
        onExportHtml,
        onExportSql,
        onExportMarkdown,
    }: ComponentProps<typeof NotebookToolbar>) => (
        <>
            <button onClick={onExport}>Export Notebook</button>
            <button onClick={onExportHtml}>Export HTML</button>
            <button onClick={onExportSql}>Export SQL</button>
            <button onClick={onExportMarkdown}>Export Markdown</button>
        </>
    ),
}));
vi.mock('@/components/notebook/NotebookCellWrapper', () => ({
    NotebookCellWrapper: ({cell, onUpdate, onRun}: ComponentProps<typeof NotebookCellWrapper>) => (
        <SqlEditorWrapper
            initialValue={cell.content}
            onChange={(content) => onUpdate({content})}
            onRun={onRun}
            editorKey={`notebook-${cell.id}`}
        />
    ),
}));

const mockSave = vi.mocked(save);
const mockWriteFile = vi.mocked(writeFile);
const notebookId = 'notebook-export';
const BASE = 'SELECT id, customer, amount FROM orders ORDER BY id LIMIT 3';
const EDITED = 'SELECT id, customer, amount FROM orders WHERE amount > 20 ORDER BY id LIMIT 3';

function renderNotebook() {
    fixtures.notebooks.set(notebookId, {cells: [{id: 'q', type: 'sql', content: BASE}]});
    const tab: Tab = {
        id: 'tab-1',
        title: 'Notebook',
        type: 'notebook',
        notebookId,
        connectionId: 'connection',
        query: '',
        result: null,
        error: '',
        executionTime: null,
        page: 1,
        activeTable: null,
        pkColumns: null,
    };
    return render(
        <SettingsContext.Provider
            value={{settings: DEFAULT_SETTINGS, updateSetting: vi.fn(), isLoading: false}}
        >
            <NotebookView tab={tab} updateTab={vi.fn()} connectionId="connection" isActive />
        </SettingsContext.Provider>,
    );
}

describe('NotebookView exports with the real SQL editor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fixtures.notebooks.clear();
        mockSave.mockResolvedValue('/tmp/export');
        mockWriteFile.mockResolvedValue(undefined);
    });

    it.each(['Export Markdown', 'Export SQL', 'Export HTML', 'Export Notebook'])(
        '%s includes an edit typed just before, inside the editor debounce',
        async (button) => {
            renderNotebook();
            await act(async () => {
                await Promise.resolve();
            });

            fireEvent.change(screen.getByLabelText('SQL editor'), {target: {value: EDITED}});
            await act(async () => {
                fireEvent.click(screen.getByRole('button', {name: button}));
            });

            await waitFor(() => expect(mockWriteFile).toHaveBeenCalledOnce());
            const contents = new TextDecoder().decode(mockWriteFile.mock.calls[0][1] as Uint8Array);
            expect(contents.replace(/&gt;/g, '>')).toContain(EDITED);
            expect(fixtures.notebooks.get(notebookId)?.cells[0].content).toBe(EDITED);
        },
    );
});
