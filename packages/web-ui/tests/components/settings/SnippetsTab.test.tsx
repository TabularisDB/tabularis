import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {SnippetsTab} from '@/components/settings/SnippetsTab';
import type {DownloadFileRequest} from '@/platform/capabilities';
import {
    loadSqlSnippets,
    saveSqlSnippets,
    CURRENT_STORAGE_VERSION,
    type SqlSnippet,
} from '@/utils/sqlSnippets';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, defaultValueOrOptions?: string | Record<string, unknown>) => {
            if (typeof defaultValueOrOptions === 'string' || defaultValueOrOptions == null) {
                return defaultValueOrOptions || key;
            }
            let result =
                typeof defaultValueOrOptions.defaultValue === 'string'
                    ? defaultValueOrOptions.defaultValue
                    : key;
            for (const [name, value] of Object.entries(defaultValueOrOptions)) {
                if (name === 'defaultValue') continue;
                result = result.replaceAll(`{{${name}}}`, String(value));
            }
            return result;
        },
    }),
}));

const mocks = vi.hoisted(() => ({
    colorize: vi.fn(async (sql: string) => `<span>${sql}</span>`),
    theme: {id: 'test'},
    downloadFile: vi.fn(),
    showAlert: vi.fn(),
}));
vi.mock('@/hooks/usePlatformCapabilities', () => {
    const platform = {
        operations: mocks.downloadFile,
        downloadFile(request: DownloadFileRequest) {
            return this.operations(request);
        },
    };
    return {usePlatformCapabilities: () => platform};
});
vi.mock('@/hooks/useAlert', () => ({useAlert: () => ({showAlert: mocks.showAlert})}));
vi.mock('@/hooks/useEditorTheme', () => ({useEditorTheme: () => mocks.theme}));
vi.mock('@/hooks/useDrivers', () => ({
    useDrivers: () => ({
        drivers: [
            {
                id: 'postgres',
                name: 'PostgreSQL',
                is_builtin: true,
                capabilities: {sql_dialect: 'postgres'},
            },
            {id: 'mysql', name: 'MySQL', is_builtin: true, capabilities: {sql_dialect: 'mysql'}},
            {id: 'sqlite', name: 'SQLite', is_builtin: true, capabilities: {sql_dialect: 'sqlite'}},
            {
                id: 'oracle',
                name: 'Oracle',
                is_builtin: false,
                capabilities: {sql_dialect: 'oracle'},
            },
        ],
    }),
}));
vi.mock('@/utils/monaco', () => ({
    ensureMonaco: async () => ({editor: {colorize: mocks.colorize}}),
}));
vi.mock('@/themes/themeRuntime', () => ({getMonacoThemeId: () => 'test'}));
vi.mock('@/themes/themeUtils', () => ({loadMonacoTheme: vi.fn()}));
vi.mock('@/components/ui/LazyMonaco', () => ({
    MonacoEditor: ({
        value,
        onChange,
        options,
    }: {
        value: string;
        onChange: (v: string) => void;
        options: {ariaLabel: string};
    }) => (
        <textarea
            aria-label={options.ariaLabel}
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
}));

describe('SnippetsTab', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        mocks.downloadFile.mockReset().mockResolvedValue(true);
    });

    it('exports the complete saved library as UTF-8 JSON without an unsaved draft or unrelated storage', async () => {
        const library = loadSqlSnippets();
        library[0] = {
            ...library[0],
            name: '訂單 – Grüße',
            body: 'SELECT ${1:列};\n\t\\${escaped} $0',
        };
        saveSqlSnippets(library);
        render(<SnippetsTab />);
        const saved = loadSqlSnippets();
        localStorage.setItem('connections', JSON.stringify({password: 'do-not-export'}));
        const before = {...localStorage};
        fireEvent.click(screen.getAllByRole('button', {name: 'Edit'})[0]);
        fireEvent.change(screen.getByLabelText('Snippet Name'), {target: {value: 'Unsaved draft'}});
        fireEvent.click(screen.getByRole('button', {name: 'Export JSON'}));
        await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledOnce());
        const request = mocks.downloadFile.mock.calls[0][0];
        expect(request).toMatchObject({
            fileName: 'tabularis-snippets.json',
            mimeType: 'application/json',
            filters: [{name: 'JSON', extensions: ['json']}],
        });
        expect(JSON.parse(new TextDecoder().decode(request.contents))).toEqual({
            version: CURRENT_STORAGE_VERSION,
            snippets: saved,
        });
        expect({...localStorage}).toEqual(before);
        expect(screen.getByLabelText('Snippet Name')).toHaveValue('Unsaved draft');
    });

    it('disables export for an empty library', () => {
        saveSqlSnippets([]);
        render(<SnippetsTab />);
        const button = screen.getByRole('button', {name: 'Export JSON'});
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(mocks.downloadFile).not.toHaveBeenCalled();
    });

    it.each(['cancel', 'failure'])(
        'leaves storage untouched on export %s and permits retry',
        async (outcome) => {
            if (outcome === 'cancel') mocks.downloadFile.mockResolvedValueOnce(false);
            else mocks.downloadFile.mockRejectedValueOnce(new Error('write failed'));
            render(<SnippetsTab />);
            const before = {...localStorage};
            const button = screen.getByRole('button', {name: 'Export JSON'});
            fireEvent.click(button);
            await waitFor(() => expect(button).toBeEnabled());
            if (outcome === 'failure')
                expect(mocks.showAlert).toHaveBeenCalledWith(
                    'Failed to export snippets: write failed',
                    {
                        kind: 'error',
                    },
                );
            else expect(mocks.showAlert).not.toHaveBeenCalled();
            expect({...localStorage}).toEqual(before);
            fireEvent.click(button);
            await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledTimes(2));
        },
    );

    it('combines search and stored scopes while preserving an unsaved edit and storage', () => {
        const snippets: SqlSnippet[] = [
            {
                id: 'generic',
                name: 'Generic orders',
                prefix: 'ord',
                body: 'SELECT $1;',
                createdAt: '',
                updatedAt: '',
            },
            {
                id: 'pg',
                name: 'Postgres orders',
                prefix: 'pg',
                body: 'SELECT 2;',
                dialect: 'postgres',
                createdAt: '',
                updatedAt: '',
            },
            {
                id: 'plugin',
                name: 'Oracle orders',
                prefix: 'ora',
                body: 'SELECT 3;',
                dialect: 'driver:oracle',
                createdAt: '',
                updatedAt: '',
            },
            {
                id: 'offline',
                name: 'Offline orders',
                prefix: 'off',
                body: 'SELECT 4;',
                dialect: 'driver:offline',
                createdAt: '',
                updatedAt: '',
            },
        ];
        saveSqlSnippets(snippets);
        render(<SnippetsTab />);
        const search = screen.getByRole('searchbox', {name: 'Search snippets'});
        const scope = screen.getByRole('button', {name: 'Filter by scope'});
        expect(scope).toHaveTextContent('All scopes');
        fireEvent.click(screen.getAllByRole('button', {name: 'Edit'})[0]);
        fireEvent.change(screen.getByLabelText('Snippet Name'), {target: {value: 'Unsaved draft'}});
        fireEvent.change(search, {target: {value: ' ORDERS '}});
        fireEvent.click(scope);
        fireEvent.click(screen.getByText('PostgreSQL', {selector: 'button span'}));
        expect(screen.queryByText('Generic orders')).not.toBeInTheDocument();
        expect(screen.getByText('Postgres orders')).toBeInTheDocument();
        expect(screen.queryByText('Oracle orders')).not.toBeInTheDocument();

        fireEvent.click(scope);
        fireEvent.click(screen.getByText('Oracle', {selector: 'button span'}));
        expect(screen.getByText('Oracle orders')).toBeInTheDocument();
        fireEvent.click(scope);
        fireEvent.click(screen.getByText('offline', {selector: 'button span'}));
        expect(screen.getByText('Offline orders')).toBeInTheDocument();
        fireEvent.change(search, {target: {value: 'absent'}});
        expect(screen.getByText('No matching snippets.')).toBeInTheDocument();
        expect(screen.queryByText('No SQL snippets configured yet.')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Snippet Name')).toHaveValue('Unsaved draft');

        fireEvent.change(search, {target: {value: ''}});
        fireEvent.click(scope);
        fireEvent.click(screen.getByText('Generic (all dialects)'));
        expect(screen.getByText('Generic orders')).toBeInTheDocument();
        expect(screen.queryByText('Offline orders')).not.toBeInTheDocument();
        fireEvent.click(scope);
        fireEvent.click(screen.getByText('All scopes'));
        expect(screen.getAllByRole('button', {name: 'Edit'})).toHaveLength(4);
        expect(screen.getByLabelText('Snippet Name')).toHaveValue('Unsaved draft');
        expect(loadSqlSnippets()).toEqual(snippets);
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));
        expect(loadSqlSnippets()[0].name).toBe('Unsaved draft');
        expect(loadSqlSnippets().slice(1)).toEqual(snippets.slice(1));
    });

    it.each(['delete', 'rescope'])(
        'falls back to all scopes after removing the last scope by %s',
        (action) => {
            const snippets: SqlSnippet[] = [
                {
                    id: 'generic',
                    name: 'Generic orders',
                    prefix: 'ord',
                    body: 'SELECT 1;',
                    dialect: 'all',
                    createdAt: '',
                    updatedAt: '',
                },
                {
                    id: 'plugin',
                    name: 'Plugin orders',
                    prefix: 'plug',
                    body: 'SELECT 2;',
                    dialect: 'driver:offline',
                    createdAt: '',
                    updatedAt: '',
                },
            ];
            saveSqlSnippets(snippets);
            render(<SnippetsTab />);
            const scope = screen.getByRole('button', {name: 'Filter by scope'});
            fireEvent.change(screen.getByRole('searchbox'), {target: {value: 'orders'}});
            fireEvent.click(scope);
            fireEvent.click(screen.getByText('offline', {selector: 'button span'}));
            expect(screen.queryByText('Generic orders')).not.toBeInTheDocument();
            if (action === 'delete') {
                fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
            } else {
                fireEvent.click(screen.getByRole('button', {name: 'Edit'}));
                fireEvent.click(screen.getByRole('button', {name: 'Dialect Scope'}));
                fireEvent.click(screen.getByText('All Dialects'));
                fireEvent.click(screen.getByRole('button', {name: 'Save'}));
            }
            expect(scope).toHaveTextContent('All scopes');
            expect(screen.getByText('Generic orders')).toBeInTheDocument();
            expect(screen.queryByText('No matching snippets.')).not.toBeInTheDocument();
            expect(screen.getByRole('searchbox')).toHaveValue('orders');
            fireEvent.click(scope);
            expect(
                screen.queryByText('offline', {selector: 'button span'}),
            ).not.toBeInTheDocument();
            expect(loadSqlSnippets()).toHaveLength(action === 'delete' ? 1 : 2);
        },
    );

    it('keeps all-scopes after a vanished filter even when that scope is created again', () => {
        const snippets: SqlSnippet[] = [
            {
                id: 'generic',
                name: 'Generic orders',
                prefix: 'ord',
                body: 'SELECT 1;',
                dialect: 'all',
                createdAt: '',
                updatedAt: '',
            },
            {
                id: 'pg',
                name: 'Postgres orders',
                prefix: 'pg',
                body: 'SELECT 2;',
                dialect: 'postgres',
                createdAt: '',
                updatedAt: '',
            },
        ];
        saveSqlSnippets(snippets);
        render(<SnippetsTab />);
        const scope = screen.getByRole('button', {name: 'Filter by scope'});
        fireEvent.click(scope);
        fireEvent.click(screen.getByText('PostgreSQL', {selector: 'button span'}));
        expect(screen.queryByText('Generic orders')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
        expect(scope).toHaveTextContent('All scopes');
        expect(screen.getByText('Generic orders')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: /New Snippet/i}));
        fireEvent.change(screen.getByPlaceholderText(/e.g. Select Active Orders/i), {
            target: {value: 'Postgres again'},
        });
        fireEvent.change(screen.getByPlaceholderText(/e.g. selorders/i), {
            target: {value: 'pg2'},
        });
        fireEvent.change(screen.getByRole('textbox', {name: 'Snippet Body'}), {
            target: {value: 'SELECT 3;'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'Dialect Scope'}));
        fireEvent.click(screen.getByText('PostgreSQL'));
        fireEvent.click(screen.getByRole('button', {name: /Save/i}));
        expect(scope).toHaveTextContent('All scopes');
        expect(screen.getByText('Generic orders')).toBeInTheDocument();
        expect(screen.getByText('Postgres again')).toBeInTheDocument();
    });

    it('hides search and scope filters when the library is empty', () => {
        saveSqlSnippets([]);
        render(<SnippetsTab />);
        expect(screen.getByText('No SQL snippets configured yet.')).toBeInTheDocument();
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Filter by scope'})).not.toBeInTheDocument();
        expect(screen.queryByText('No matching snippets.')).not.toBeInTheDocument();
    });

    it('renders snippet list and default items', () => {
        render(<SnippetsTab />);

        expect(screen.getByText('SQL Snippets')).toBeInTheDocument();
        expect(screen.getByText('Select From')).toBeInTheDocument();
        expect(screen.getByText('sel')).toBeInTheDocument();
        expect(screen.getByText('Inner Join')).toBeInTheDocument();
    });

    it('creates a new custom snippet with validation', () => {
        render(<SnippetsTab />);

        // Click New Snippet
        fireEvent.click(screen.getByRole('button', {name: /New Snippet/i}));
        expect(screen.getByText('Create Snippet')).toBeInTheDocument();

        // Invalid prefix should fail validation
        fireEvent.change(screen.getByPlaceholderText(/e.g. selorders/i), {
            target: {value: 'invalid prefix with spaces'},
        });
        fireEvent.change(screen.getByRole('textbox', {name: 'Snippet Body'}), {
            target: {value: 'SELECT 1;'},
        });
        fireEvent.click(screen.getByRole('button', {name: /Save/i}));
        expect(screen.getByText(/Prefix must contain only letters, numbers/i)).toBeInTheDocument();

        // Duplicate prefix ('sel' already exists in defaults) should fail validation
        fireEvent.change(screen.getByPlaceholderText(/e.g. selorders/i), {
            target: {value: 'sel'},
        });
        fireEvent.click(screen.getByRole('button', {name: /Save/i}));
        expect(
            screen.getByText(/A snippet with this prefix already exists for this dialect scope/i),
        ).toBeInTheDocument();

        // Fill in form
        fireEvent.change(screen.getByPlaceholderText(/e.g. Select Active Orders/i), {
            target: {value: 'Count Pending'},
        });
        fireEvent.change(screen.getByPlaceholderText(/e.g. selorders/i), {
            target: {value: 'cntp'},
        });
        fireEvent.change(screen.getByRole('textbox', {name: 'Snippet Body'}), {
            target: {value: 'SELECT COUNT(*) FROM orders WHERE status = ${1:pending};'},
        });

        fireEvent.click(screen.getByRole('button', {name: /Save/i}));

        expect(screen.getByText('Count Pending')).toBeInTheDocument();
        expect(screen.getByText('cntp')).toBeInTheDocument();
    });

    it('preserves the snippet body and selected dialect when saving', () => {
        render(<SnippetsTab />);
        fireEvent.click(screen.getByRole('button', {name: /New Snippet/i}));
        fireEvent.change(screen.getByPlaceholderText(/e.g. selorders/i), {
            target: {value: 'pending'},
        });
        fireEvent.change(screen.getByRole('textbox', {name: 'Snippet Body'}), {
            target: {value: 'SELECT ${1:column} FROM orders;'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'Dialect Scope'}));
        fireEvent.click(screen.getByText('PostgreSQL'));
        fireEvent.click(screen.getByRole('button', {name: /Save/i}));
        expect(screen.getByText('SELECT ${1:column} FROM orders;')).toBeInTheDocument();
        expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    });

    it('lists enabled driver scopes and saves a plugin-specific snippet', () => {
        render(<SnippetsTab />);
        fireEvent.click(screen.getByRole('button', {name: /New Snippet/i}));
        fireEvent.change(screen.getByPlaceholderText(/e.g. selorders/i), {target: {value: 'ora'}});
        fireEvent.change(screen.getByRole('textbox', {name: 'Snippet Body'}), {
            target: {value: 'SELECT * FROM dual;'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'Dialect Scope'}));
        fireEvent.click(screen.getByText('Oracle'));
        fireEvent.click(screen.getByRole('button', {name: /Save/i}));
        expect(screen.getByText('Oracle')).toBeInTheDocument();
    });

    it('highlights previews with the snippet dialect', async () => {
        saveSqlSnippets([
            {
                id: 'pg',
                name: 'Postgres sample',
                prefix: 'pg',
                body: 'SELECT 1;',
                dialect: 'postgres',
                createdAt: '',
                updatedAt: '',
            },
            {
                id: 'my',
                name: 'MySQL sample',
                prefix: 'my',
                body: 'SELECT 2;',
                dialect: 'mysql',
                createdAt: '',
                updatedAt: '',
            },
            {
                id: 'sq',
                name: 'SQLite sample',
                prefix: 'sq',
                body: 'SELECT 3;',
                dialect: 'sqlite',
                createdAt: '',
                updatedAt: '',
            },
        ]);
        render(<SnippetsTab />);
        await waitFor(() => {
            expect(mocks.colorize).toHaveBeenCalledWith('SELECT 1;', 'pgsql', {tabSize: 4});
            expect(mocks.colorize).toHaveBeenCalledWith('SELECT 2;', 'mysql', {tabSize: 4});
            expect(mocks.colorize).toHaveBeenCalledWith('SELECT 3;', 'sql', {tabSize: 4});
        });
    });

    it('edits an existing snippet', () => {
        const initialSnippets: SqlSnippet[] = [
            {
                id: 's-edit-1',
                name: 'Initial Name',
                prefix: 'init',
                body: 'SELECT 1;',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
            },
        ];
        saveSqlSnippets(initialSnippets);

        render(<SnippetsTab />);

        expect(screen.getByText('Initial Name')).toBeInTheDocument();

        // Click edit
        fireEvent.click(screen.getByTitle('Edit'));
        expect(screen.getByText('Edit Snippet')).toBeInTheDocument();

        // Change name and save
        fireEvent.change(screen.getByPlaceholderText(/e.g. Select Active Orders/i), {
            target: {value: 'Updated Name'},
        });
        fireEvent.click(screen.getByRole('button', {name: /Save/i}));

        expect(screen.getByText('Updated Name')).toBeInTheDocument();
        expect(screen.queryByText('Initial Name')).not.toBeInTheDocument();
    });

    it.each(['all', 'postgres', 'driver:oracle', 'driver:unavailable'] as const)(
        'duplicates a %s snippet with a unique name and prefix on the first save',
        (dialect) => {
            const source: SqlSnippet = {
                id: 'source',
                name: 'Active orders',
                prefix: 'orders',
                body: '  SELECT ${1:column}, $2 FROM ${3:orders};\n\t$0  ',
                description: dialect === 'all' ? undefined : 'Order template',
                dialect,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
            };
            saveSqlSnippets([source]);
            render(<SnippetsTab />);

            fireEvent.click(screen.getByRole('button', {name: 'Duplicate'}));
            expect(screen.getByText('Create Snippet')).toBeInTheDocument();
            expect(screen.getByLabelText('Snippet Name')).toHaveValue('Active orders (copy)');
            expect(screen.getByLabelText(/Trigger Prefix/)).toHaveValue('orders_copy');
            expect(screen.getByLabelText('Snippet Body')).toHaveValue(source.body);
            expect(screen.getByLabelText('Description')).toHaveValue(source.description ?? '');
            expect(screen.getByRole('button', {name: 'Dialect Scope'})).toHaveTextContent(
                {
                    all: 'All Dialects',
                    postgres: 'PostgreSQL',
                    'driver:oracle': 'Oracle',
                    'driver:unavailable': 'unavailable',
                }[dialect],
            );
            expect(loadSqlSnippets()).toEqual([source]);

            fireEvent.click(screen.getByRole('button', {name: 'Save'}));
            const [original, duplicate] = loadSqlSnippets();
            expect(original).toEqual(source);
            expect(duplicate).toMatchObject({
                ...source,
                name: 'Active orders (copy)',
                prefix: 'orders_copy',
                id: expect.any(String),
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
            });
            expect(duplicate.id).not.toBe(source.id);
            expect(duplicate.createdAt).not.toBe(source.createdAt);
            expect(duplicate.updatedAt).toBe(duplicate.createdAt);

            fireEvent.click(screen.getAllByRole('button', {name: 'Edit'})[1]);
            fireEvent.change(screen.getByLabelText('Snippet Body'), {target: {value: 'SELECT 2;'}});
            fireEvent.click(screen.getByRole('button', {name: 'Save'}));
            expect(loadSqlSnippets()[0]).toEqual(source);
            expect(loadSqlSnippets()[1].body).toBe('SELECT 2;');
        },
    );

    it('increments copy suffixes when the suggested name or prefix is already taken', () => {
        const source: SqlSnippet = {
            id: 'source',
            name: 'Active orders',
            prefix: 'orders',
            body: 'SELECT 1;',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };
        saveSqlSnippets([
            source,
            {
                ...source,
                id: 'existing-copy',
                name: 'Active orders (copy)',
                prefix: 'orders_copy',
            },
        ]);
        render(<SnippetsTab />);

        fireEvent.click(screen.getAllByRole('button', {name: 'Duplicate'})[0]);
        expect(screen.getByLabelText('Snippet Name')).toHaveValue('Active orders (copy 2)');
        expect(screen.getByLabelText(/Trigger Prefix/)).toHaveValue('orders_copy_2');
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));
        expect(loadSqlSnippets()[2]).toMatchObject({
            name: 'Active orders (copy 2)',
            prefix: 'orders_copy_2',
            body: source.body,
        });
    });

    it('still rejects saving a duplicate that reuses the original prefix', () => {
        const source: SqlSnippet = {
            id: 'source',
            name: 'Active orders',
            prefix: 'orders',
            body: 'SELECT 1;',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };
        saveSqlSnippets([source]);
        render(<SnippetsTab />);

        fireEvent.click(screen.getByRole('button', {name: 'Duplicate'}));
        fireEvent.change(screen.getByLabelText(/Trigger Prefix/), {target: {value: 'orders'}});
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));
        expect(screen.getByText(/A snippet with this prefix already exists/)).toBeInTheDocument();
        expect(loadSqlSnippets()).toEqual([source]);
    });

    it('rejects a scoped prefix that overlaps a persisted global snippet without a dialect', () => {
        saveSqlSnippets([
            {
                id: 'legacy',
                name: 'Legacy global',
                prefix: 'orders',
                body: 'SELECT 1;',
                createdAt: '',
                updatedAt: '',
            },
            {
                id: 'scoped',
                name: 'Scoped orders',
                prefix: 'pgorders',
                body: 'SELECT 2;',
                dialect: 'postgres',
                createdAt: '',
                updatedAt: '',
            },
        ]);
        render(<SnippetsTab />);

        fireEvent.click(screen.getAllByRole('button', {name: 'Edit'})[1]);
        fireEvent.change(screen.getByLabelText(/Trigger Prefix/), {target: {value: 'ORDERS'}});
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));

        expect(screen.getByText(/A snippet with this prefix already exists/)).toBeInTheDocument();
        expect(loadSqlSnippets().find((snippet) => snippet.id === 'scoped')?.prefix).toBe(
            'pgorders',
        );
    });

    it('cancels a duplicate without changing storage or retaining the source id', () => {
        render(<SnippetsTab />);
        const source = loadSqlSnippets()[0];
        const saved = localStorage.getItem('tabularis.sql_snippets.v1');
        fireEvent.click(screen.getAllByRole('button', {name: 'Edit'})[0]);
        fireEvent.change(screen.getByLabelText('Snippet Name'), {target: {value: 'Unsaved edit'}});
        fireEvent.click(screen.getAllByRole('button', {name: 'Duplicate'})[0]);
        expect(screen.getByText('Create Snippet')).toBeInTheDocument();
        expect(screen.getByLabelText('Snippet Name')).toHaveValue(`${source.name} (copy)`);
        expect(screen.getByLabelText(/Trigger Prefix/)).toHaveValue(`${source.prefix}_copy`);
        expect(screen.getByLabelText('Description')).toHaveValue(source.description);
        fireEvent.change(screen.getByLabelText('Snippet Body'), {target: {value: 'SELECT 2;'}});
        fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
        expect(screen.queryByText('Create Snippet')).not.toBeInTheDocument();
        expect(localStorage.getItem('tabularis.sql_snippets.v1')).toBe(saved);
        expect(loadSqlSnippets()[0]).toEqual(source);
    });

    it('scrolls the form into view and focuses the name when duplicating or editing', () => {
        const source: SqlSnippet = {
            id: 'source',
            name: 'Active orders',
            prefix: 'orders',
            body: 'SELECT 1;',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };
        saveSqlSnippets([source]);
        render(<SnippetsTab />);
        const scrollIntoView = vi.spyOn(HTMLFormElement.prototype, 'scrollIntoView');

        fireEvent.click(screen.getByRole('button', {name: 'Duplicate'}));
        const createForm = screen.getByText('Create Snippet').closest('form');
        expect(createForm).toBeTruthy();
        expect(scrollIntoView.mock.contexts).toContain(createForm);
        expect(scrollIntoView).toHaveBeenCalledWith({behavior: 'smooth', block: 'start'});
        expect(screen.getByLabelText('Snippet Name')).toHaveFocus();

        fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
        scrollIntoView.mockClear();
        fireEvent.click(screen.getByRole('button', {name: 'Edit'}));
        const editForm = screen.getByText('Edit Snippet').closest('form');
        expect(editForm).toBeTruthy();
        expect(scrollIntoView.mock.contexts).toContain(editForm);
        expect(screen.getByLabelText('Snippet Name')).toHaveFocus();
        scrollIntoView.mockRestore();
    });

    it('deletes a snippet', () => {
        const initialSnippets: SqlSnippet[] = [
            {
                id: 's-del-1',
                name: 'Delete Me',
                prefix: 'delme',
                body: 'SELECT 1;',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
            },
        ];
        saveSqlSnippets(initialSnippets);

        render(<SnippetsTab />);

        expect(screen.getByText('Delete Me')).toBeInTheDocument();

        fireEvent.click(screen.getByTitle('Delete'));
        expect(screen.queryByText('Delete Me')).not.toBeInTheDocument();
    });
});
