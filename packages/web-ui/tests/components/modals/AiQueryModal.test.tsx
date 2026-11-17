import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {AiQueryModal} from '@/components/modals/AiQueryModal';

const {invokeMock} = vi.hoisted(() => ({
    invokeMock: vi.fn(),
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => ({call: invokeMock}),
}));

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({
        activeConnectionId: 'active-connection',
        activeSchema: 'public',
        activeDatabaseName: 'active-database',
    }),
}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({
        settings: {
            aiProvider: 'custom-openai',
            aiModel: 'test-model',
        },
    }),
}));

vi.mock('@/components/ui/Modal', () => ({
    Modal: ({isOpen, children}: {isOpen: boolean; children: React.ReactNode}) =>
        isOpen ? <div>{children}</div> : null,
}));

describe('AiQueryModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('waits for the driver schema context before generating SQL', async () => {
        let resolveSchema: ((value: string) => void) | undefined;
        const schemaPromise = new Promise<string>((resolve) => {
            resolveSchema = resolve;
        });
        invokeMock.mockImplementation((command: string) => {
            if (command === 'get_ai_schema_context') return schemaPromise;
            if (command === 'generate_ai_query') return Promise.resolve('SELECT 1');
            return Promise.reject(new Error(`Unexpected command: ${command}`));
        });
        const onInsert = vi.fn();

        render(
            <AiQueryModal
                isOpen
                onClose={vi.fn()}
                onInsert={onInsert}
                connectionId="plugin-connection"
                schema="analytics"
            />,
        );

        fireEvent.change(screen.getByPlaceholderText(/Find all users/i), {
            target: {value: 'Count users'},
        });
        fireEvent.click(screen.getByRole('button', {name: /Generate SQL/i}));

        expect(
            invokeMock.mock.calls.filter(([command]) => command === 'generate_ai_query'),
        ).toHaveLength(0);

        resolveSchema?.('Table: "users"\n  - id bigint PK NOT NULL');

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('generate_ai_query', {
                req: {
                    provider: 'custom-openai',
                    model: 'test-model',
                    prompt: 'Count users',
                    schema: 'Table: "users"\n  - id bigint PK NOT NULL',
                },
            });
        });
        expect(onInsert).toHaveBeenCalledWith('SELECT 1');
    });

    it('prefills the Fix with AI prompt and sends it through generate_ai_query with schema context', async () => {
        invokeMock.mockImplementation((command: string) => {
            if (command === 'get_ai_schema_context') return Promise.resolve('Table: "users"');
            if (command === 'generate_ai_query') return Promise.resolve('SELECT 1');
            return Promise.reject(new Error(`Unexpected command: ${command}`));
        });
        const onInsert = vi.fn();

        render(
            <AiQueryModal
                isOpen
                onClose={vi.fn()}
                onInsert={onInsert}
                initialPrompt={'Fix this query. It failed with: boom\n\nSELEC 1'}
            />,
        );

        const textarea = screen.getByPlaceholderText(/Find all users/i) as HTMLTextAreaElement;
        expect(textarea.value).toBe('Fix this query. It failed with: boom\n\nSELEC 1');

        await waitFor(() => expect(screen.queryByText(/Reading database schema/i)).toBeNull());
        fireEvent.click(screen.getByRole('button', {name: /Generate SQL/i}));

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('generate_ai_query', {
                req: {
                    provider: 'custom-openai',
                    model: 'test-model',
                    prompt: 'Fix this query. It failed with: boom\n\nSELEC 1',
                    schema: 'Table: "users"',
                },
            });
        });
        expect(onInsert).toHaveBeenCalledWith('SELECT 1');
    });

    it('clears a cancelled fix prompt when reopened for ordinary Generate, keeping ordinary drafts', () => {
        const props = {onClose: vi.fn(), onInsert: vi.fn()};
        const field = () => screen.getByPlaceholderText(/Find all users/i) as HTMLTextAreaElement;
        invokeMock.mockResolvedValue('');
        const {rerender} = render(
            <AiQueryModal isOpen initialPrompt="Fix this query" {...props} />,
        );
        expect(field().value).toBe('Fix this query');

        rerender(<AiQueryModal isOpen={false} {...props} />);
        rerender(<AiQueryModal isOpen {...props} />);
        expect(field().value).toBe('');

        fireEvent.change(field(), {target: {value: 'my draft'}});
        rerender(<AiQueryModal isOpen={false} {...props} />);
        rerender(<AiQueryModal isOpen {...props} />);
        expect(field().value).toBe('my draft');
    });

    it("does not fall back to the active connection's database when passed a different connectionId", async () => {
        // A caller passing an explicit connectionId for a non-active connection
        // must not silently pull the active connection's database — leave the
        // database unset so the backend uses the passed connection's saved
        // database. See #1119.
        invokeMock.mockResolvedValue('');

        render(
            <AiQueryModal
                isOpen
                onClose={vi.fn()}
                onInsert={vi.fn()}
                connectionId="plugin-connection"
                schema="warehouse"
            />,
        );

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('get_ai_schema_context', {
                connectionId: 'plugin-connection',
                schema: 'warehouse',
                // No `database` field — the active connection's database is NOT used.
            });
        });
    });

    it("falls back to the active connection's database for the active connection but not a different one", async () => {
        // Both arms of the guard in one test, so it stays non-vacuous against a
        // full revert: reverting to `database ?? activeDatabaseName ?? undefined`
        // keeps the active-connection assertion passing but makes the
        // non-active-connection assertion fail (the old code would send the
        // active database for "plugin-connection" too). See #1119.
        invokeMock.mockResolvedValue('');

        // Active connection → fallback fires.
        const {unmount} = render(
            <AiQueryModal
                isOpen
                onClose={vi.fn()}
                onInsert={vi.fn()}
                connectionId="active-connection"
                schema="warehouse"
            />,
        );
        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('get_ai_schema_context', {
                connectionId: 'active-connection',
                schema: 'warehouse',
                database: 'active-database',
            });
        });
        unmount();

        // Non-active connection → no fallback (active database NOT pulled in).
        render(
            <AiQueryModal
                isOpen
                onClose={vi.fn()}
                onInsert={vi.fn()}
                connectionId="plugin-connection"
                schema="warehouse"
            />,
        );
        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('get_ai_schema_context', {
                connectionId: 'plugin-connection',
                schema: 'warehouse',
            });
        });
    });

    it('scopes schema context to the database passed by the caller, overriding the context fallback', async () => {
        invokeMock.mockResolvedValue('');

        render(
            <AiQueryModal
                isOpen
                onClose={vi.fn()}
                onInsert={vi.fn()}
                connectionId="plugin-connection"
                schema="warehouse"
                database="orders_db"
            />,
        );

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('get_ai_schema_context', {
                connectionId: 'plugin-connection',
                schema: 'warehouse',
                database: 'orders_db',
            });
        });
    });
});
