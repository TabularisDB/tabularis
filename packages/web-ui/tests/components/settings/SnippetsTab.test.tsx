import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {SnippetsTab} from '@/components/settings/SnippetsTab';
import {loadSqlSnippets, saveSqlSnippets, type SqlSnippet} from '@/utils/sqlSnippets';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, defaultValue?: string) => defaultValue || key,
    }),
}));

const mocks = vi.hoisted(() => ({
    colorize: vi.fn(async (sql: string) => `<span>${sql}</span>`),
    theme: {id: 'test'},
}));
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
