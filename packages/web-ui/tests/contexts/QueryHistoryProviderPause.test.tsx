import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {invoke} from '@tauri-apps/api/core';
import {useState} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {QueryHistoryProvider} from '@/contexts/QueryHistoryProvider';
import {useQueryHistory} from '@/hooks/useQueryHistory';
import {QueryHistorySection} from '@/components/layout/sidebar/QueryHistorySection';
import type {QueryHistoryEntry} from '@/types/queryHistory';

vi.mock('lucide-react', async (importOriginal) => await importOriginal());
vi.mock('@/hooks/useTabularisClient', () => import('../support/tauriBackedHooks'));

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({
        activeConnectionId: 'conn-1',
    }),
}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({
        settings: {},
    }),
}));

const invokeMock = vi.mocked(invoke);

function makeEntry(id: string, sql: string): QueryHistoryEntry {
    return {
        id,
        sql,
        executedAt: '2026-10-17T12:00:00.000Z',
        executionTimeMs: 12,
        status: 'success',
        rowsAffected: 1,
        error: null,
        database: 'main',
    };
}

function Harness() {
    const {
        entries,
        isLoading,
        isPaused,
        togglePaused,
        recoveryNotice,
        dismissRecoveryNotice,
        addEntry,
        clearHistory,
    } = useQueryHistory();
    const [sectionOpen, setSectionOpen] = useState(true);

    return (
        <div>
            <button type="button" onClick={() => setSectionOpen((prev) => !prev)}>
                toggle-section
            </button>
            <button
                type="button"
                onClick={() => {
                    void addEntry('SELECT 1;', 10, 'success', 1, null, 'main');
                }}
            >
                run-select-1
            </button>
            <button
                type="button"
                onClick={() => {
                    void addEntry('SELECT 2;', 15, 'success', 1, null, 'main');
                }}
            >
                run-select-2
            </button>
            <button
                type="button"
                onClick={() => {
                    void addEntry('SELECT 3;', 20, 'success', 1, null, 'main');
                }}
            >
                run-select-3
            </button>
            {sectionOpen && (
                <QueryHistorySection
                    entries={entries}
                    isLoading={isLoading}
                    isPaused={isPaused}
                    onTogglePaused={togglePaused}
                    recoveryNotice={recoveryNotice}
                    onDismissRecoveryNotice={dismissRecoveryNotice}
                    onDoubleClick={vi.fn()}
                    onContextMenu={vi.fn()}
                    onClearAll={() => {
                        void clearHistory();
                    }}
                />
            )}
        </div>
    );
}

describe('QueryHistoryProvider pause and resume capture', () => {
    beforeEach(() => {
        invokeMock.mockReset();
        let seq = 0;
        invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
            if (cmd === 'get_query_history') {
                return {entries: [], recoveredBackupPath: null};
            }
            if (cmd === 'add_query_history_entry') {
                seq += 1;
                const payload = args as {sql: string};
                return makeEntry(`entry-${seq}`, payload.sql);
            }
            return undefined;
        });
    });

    it('skips add_query_history_entry while paused and records subsequent queries after resume without backfilling', async () => {
        render(
            <QueryHistoryProvider>
                <Harness />
            </QueryHistoryProvider>,
        );

        await waitFor(() =>
            expect(invokeMock).toHaveBeenCalledWith('get_query_history', {
                connectionId: 'conn-1',
            }),
        );

        // Record initial query while capture is active
        fireEvent.click(screen.getByText('run-select-1'));
        await waitFor(() =>
            expect(invokeMock).toHaveBeenCalledWith(
                'add_query_history_entry',
                expect.objectContaining({sql: 'SELECT 1;'}),
            ),
        );

        // Pause history capture
        const pauseButton = screen.getByRole('button', {
            name: 'sidebar.pauseHistoryCapture',
        });
        expect(pauseButton).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(pauseButton);

        expect(
            screen.getByRole('button', {
                name: 'sidebar.pauseHistoryCapture',
                pressed: true,
            }),
        ).toBe(pauseButton);
        expect(screen.getByRole('status')).toHaveTextContent('sidebar.historyCapturePausedNotice');

        // Execute exploratory query while paused — IPC must not be called
        const callsBeforePausedQuery = invokeMock.mock.calls.filter(
            ([cmd]) => cmd === 'add_query_history_entry',
        ).length;
        await act(async () => {
            fireEvent.click(screen.getByText('run-select-2'));
        });
        const callsAfterPausedQuery = invokeMock.mock.calls.filter(
            ([cmd]) => cmd === 'add_query_history_entry',
        ).length;
        expect(callsAfterPausedQuery).toBe(callsBeforePausedQuery);

        // Resume capture and run subsequent query — only SELECT 3 is recorded
        fireEvent.click(screen.getByRole('button', {name: 'sidebar.resumeHistoryCapture'}));
        expect(pauseButton).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('status')).toBeEmptyDOMElement();

        fireEvent.click(screen.getByText('run-select-3'));
        await waitFor(() =>
            expect(invokeMock).toHaveBeenCalledWith(
                'add_query_history_entry',
                expect.objectContaining({sql: 'SELECT 3;'}),
            ),
        );

        const recordedSqls = invokeMock.mock.calls
            .filter(([cmd]) => cmd === 'add_query_history_entry')
            .map(([, payload]) => (payload as {sql: string}).sql);
        expect(recordedSqls).toEqual(['SELECT 1;', 'SELECT 3;']);
    });

    it('preserves paused state across closing and reopening the history section and resets on provider restart', async () => {
        const {unmount} = render(
            <QueryHistoryProvider>
                <Harness />
            </QueryHistoryProvider>,
        );

        await waitFor(() =>
            expect(invokeMock).toHaveBeenCalledWith('get_query_history', {
                connectionId: 'conn-1',
            }),
        );

        // Pause capture
        fireEvent.click(screen.getByRole('button', {name: 'sidebar.pauseHistoryCapture'}));
        expect(screen.getByRole('status')).toHaveTextContent('sidebar.historyCapturePausedNotice');

        // Close and reopen the history section within the same provider session
        fireEvent.click(screen.getByText('toggle-section'));
        expect(screen.queryByRole('status')).toBeNull();

        // While the section is closed, queries remain suppressed
        await act(async () => {
            fireEvent.click(screen.getByText('run-select-2'));
        });
        expect(
            invokeMock.mock.calls.filter(([cmd]) => cmd === 'add_query_history_entry'),
        ).toHaveLength(0);

        // Reopen section — paused state is still active
        fireEvent.click(screen.getByText('toggle-section'));
        expect(screen.getByRole('status')).toHaveTextContent('sidebar.historyCapturePausedNotice');

        // Unmount and mount a fresh provider (simulating restart) — capture is restored
        unmount();
        render(
            <QueryHistoryProvider>
                <Harness />
            </QueryHistoryProvider>,
        );

        await waitFor(() =>
            expect(
                screen.getByRole('button', {name: 'sidebar.pauseHistoryCapture'}),
            ).toHaveAttribute('aria-pressed', 'false'),
        );

        fireEvent.click(screen.getByText('run-select-1'));
        await waitFor(() =>
            expect(invokeMock).toHaveBeenCalledWith(
                'add_query_history_entry',
                expect.objectContaining({sql: 'SELECT 1;'}),
            ),
        );
    });
});
