import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {SnippetsTab} from '@/components/settings/SnippetsTab';
import {saveSqlSnippets, type SqlSnippet} from '@/utils/sqlSnippets';

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
