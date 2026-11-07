import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {SnippetsTab} from '@/components/settings/SnippetsTab';
import {saveSqlSnippets, type SqlSnippet} from '@/utils/sqlSnippets';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, defaultValue?: string) => defaultValue || key,
    }),
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
        fireEvent.change(screen.getByPlaceholderText(/SELECT \${1:columns}/i), {
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
        fireEvent.change(screen.getByPlaceholderText(/SELECT \${1:columns}/i), {
            target: {value: 'SELECT COUNT(*) FROM orders WHERE status = ${1:pending};'},
        });

        fireEvent.click(screen.getByRole('button', {name: /Save/i}));

        expect(screen.getByText('Count Pending')).toBeInTheDocument();
        expect(screen.getByText('cntp')).toBeInTheDocument();
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
