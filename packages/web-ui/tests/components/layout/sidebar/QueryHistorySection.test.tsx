import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {useState, type ComponentProps} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {QueryHistorySection} from '@/components/layout/sidebar/QueryHistorySection';
import {TabularisClientContext} from '@/contexts/TabularisClientContext';
import type {TabularisClient} from '@/api/client';
import type {QueryHistoryEntry} from '@/types/queryHistory';

const {downloadFile} = vi.hoisted(() => ({downloadFile: vi.fn()}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({downloadFile}),
}));

vi.mock('lucide-react', async (importOriginal) => await importOriginal());

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: {displayTimezone: 'Asia/Tokyo'}}),
}));
vi.mock('@/components/ui/SqlHighlight', () => ({
    SqlHighlight: ({sql}: {sql: string}) => <pre>{sql}</pre>,
}));

const entry: QueryHistoryEntry = {
    id: 'entry-1',
    sql: 'SELECT 1;',
    executedAt: '2026-10-17T12:00:00.000Z',
    executionTimeMs: 12,
    status: 'success',
    rowsAffected: 1,
    error: null,
    database: 'main',
};

type SectionProps = Partial<ComponentProps<typeof QueryHistorySection>>;

/** Owns the paused state like the provider does. */
function PausableSection({
    initiallyPaused = false,
    ...props
}: SectionProps & {initiallyPaused?: boolean}) {
    const [isPaused, setIsPaused] = useState(initiallyPaused);
    return (
        <QueryHistorySection
            entries={[entry]}
            isLoading={false}
            recoveryNotice={null}
            onDismissRecoveryNotice={vi.fn()}
            onDoubleClick={vi.fn()}
            onContextMenu={vi.fn()}
            onClearAll={vi.fn()}
            isPaused={isPaused}
            onTogglePaused={() => setIsPaused((prev) => !prev)}
            {...props}
        />
    );
}

const pauseToggle = () => screen.getByRole('button', {name: 'sidebar.pauseHistoryCapture'});
const resumeLink = () => screen.queryByRole('button', {name: 'sidebar.resumeHistoryCapture'});

describe.each([
    ['with history entries', [entry]],
    ['with an empty history', []],
])('QueryHistorySection pause toggle (#1212) %s', (_label, entries) => {
    it('keeps one constant name and exposes the state with aria-pressed', () => {
        render(<PausableSection entries={entries} />);

        const toggle = pauseToggle();
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(toggle).toHaveAttribute('title', 'sidebar.pauseHistoryCapture');

        fireEvent.click(toggle);

        // Same element, same name; only the pressed state changes.
        expect(pauseToggle()).toBe(toggle);
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        expect(toggle).toHaveAttribute('title', 'sidebar.pauseHistoryCapture');
    });

    it('offers exactly one control per action while paused', () => {
        render(<PausableSection entries={entries} initiallyPaused />);

        expect(screen.getAllByRole('button', {name: 'sidebar.pauseHistoryCapture'})).toHaveLength(
            1,
        );
        expect(screen.getAllByRole('button', {name: 'sidebar.resumeHistoryCapture'})).toHaveLength(
            1,
        );
    });

    it('keeps the status region mounted and changes only its text', () => {
        render(<PausableSection entries={entries} />);

        const status = screen.getByRole('status');
        expect(status).toBeEmptyDOMElement();

        fireEvent.click(pauseToggle());
        expect(screen.getByRole('status')).toBe(status);
        expect(status).toHaveTextContent('sidebar.historyCapturePausedNotice');

        fireEvent.click(pauseToggle());
        expect(screen.getByRole('status')).toBe(status);
        expect(status).toBeEmptyDOMElement();
    });

    it('resumes from the banner and moves focus to the toggle', () => {
        render(<PausableSection entries={entries} initiallyPaused />);

        const link = resumeLink()!;
        link.focus();
        fireEvent.click(link);

        expect(resumeLink()).toBeNull();
        expect(pauseToggle()).toHaveAttribute('aria-pressed', 'false');
        expect(pauseToggle()).toHaveFocus();
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });
});

describe('QueryHistorySection without a pause handler', () => {
    it('renders no pause controls but keeps the status region', () => {
        render(<PausableSection onTogglePaused={undefined} initiallyPaused />);

        expect(screen.queryByRole('button', {name: 'sidebar.pauseHistoryCapture'})).toBeNull();
        expect(resumeLink()).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('sidebar.historyCapturePausedNotice');
    });
});

function makeEntry(id: string, database: string | null): QueryHistoryEntry {
    return {
        id,
        sql: `SELECT '${id}'`,
        executedAt: new Date().toISOString(),
        executionTimeMs: 5,
        status: 'success',
        rowsAffected: 1,
        error: null,
        database,
    };
}

const CONNECTION_A = [
    makeEntry('a-sales', 'sales'),
    makeEntry('a-hr', 'hr'),
    makeEntry('a-legacy', null),
];
const CONNECTION_B = [makeEntry('b-billing', 'billing'), makeEntry('b-hr', 'hr')];

function renderSection(entries: QueryHistoryEntry[]) {
    const props = {
        isLoading: false,
        recoveryNotice: null,
        onDismissRecoveryNotice: vi.fn(),
        onDoubleClick: vi.fn(),
        onContextMenu: vi.fn(),
        onClearAll: vi.fn(),
    };
    const view = render(<QueryHistorySection entries={entries} {...props} />);
    return {
        ...view,
        rerenderWith: (next: QueryHistoryEntry[]) =>
            view.rerender(<QueryHistorySection entries={next} {...props} />),
    };
}

function databaseSelect(): HTMLSelectElement {
    return screen.getByRole('combobox', {
        name: 'sidebar.historyDatabaseFilter',
    }) as HTMLSelectElement;
}

function visibleIds(): string[] {
    return screen
        .queryAllByText(/^SELECT '/)
        .map((node) => node.textContent!.slice("SELECT '".length, -1));
}

describe('QueryHistorySection database filter', () => {
    it('offers all databases, each loaded database, and entries without one', () => {
        renderSection(CONNECTION_A);

        const options = within(databaseSelect())
            .getAllByRole('option')
            .map((option) => option.textContent);
        expect(options).toEqual([
            'sidebar.historyDatabaseAll',
            'hr',
            'sales',
            'sidebar.historyDatabaseNone',
        ]);
        expect(databaseSelect().value).toBe('all');
        expect(visibleIds()).toHaveLength(3);
    });

    it("shows only the chosen database's entries and the filtered counter", () => {
        renderSection(CONNECTION_A);

        fireEvent.change(databaseSelect(), {target: {value: 'db:sales'}});
        expect(visibleIds()).toEqual(['a-sales']);
        expect(screen.getByText('1 / 3')).toBeInTheDocument();

        fireEvent.change(databaseSelect(), {target: {value: 'none'}});
        expect(visibleIds()).toEqual(['a-legacy']);
    });

    it('resets to all databases when the chosen one is not in the new entries', () => {
        const {rerenderWith} = renderSection(CONNECTION_A);
        fireEvent.change(databaseSelect(), {target: {value: 'db:sales'}});

        rerenderWith(CONNECTION_B);

        expect(databaseSelect().value).toBe('all');
        expect(visibleIds()).toHaveLength(2);
        expect(screen.queryByText(/ \/ /)).not.toBeInTheDocument();
    });

    it('keeps a chosen database that the new entries still contain', () => {
        const {rerenderWith} = renderSection(CONNECTION_A);
        fireEvent.change(databaseSelect(), {target: {value: 'db:hr'}});

        rerenderWith(CONNECTION_B);

        expect(databaseSelect().value).toBe('db:hr');
        expect(visibleIds()).toEqual(['b-hr']);
    });
});

const timeRangeSelect = () =>
    screen.getByRole('combobox', {
        name: 'sidebar.historyTimeRangeFilter',
    }) as HTMLSelectElement;
const fromInput = () => screen.queryByLabelText('sidebar.historyDateFrom');
const toInput = () => screen.queryByLabelText('sidebar.historyDateTo');

describe('QueryHistorySection custom date range (#1226)', () => {
    it('keeps From/To hidden until custom is selected', () => {
        render(<PausableSection />);

        expect(fromInput()).toBeNull();
        expect(toInput()).toBeNull();
        // The mode replaces the old standalone date fields, so it has to be a
        // visible option of the select, not a hidden extra filter.
        expect(
            within(timeRangeSelect())
                .getAllByRole('option')
                .map((option) => option.textContent),
        ).toEqual([
            'sidebar.historyTimeAll',
            'sidebar.historyTimeLastHour',
            'sidebar.historyTimeToday',
            'sidebar.historyTimeLast7Days',
            'sidebar.historyTimeLast30Days',
            'sidebar.historyTimeCustom',
        ]);
    });

    it('reveals the date inputs when custom is selected', () => {
        render(<PausableSection />);

        fireEvent.change(timeRangeSelect(), {target: {value: 'custom'}});

        expect(fromInput()).not.toBeNull();
        expect(toInput()).not.toBeNull();
    });

    it('drops the dates when switching back to a preset', () => {
        render(<PausableSection />);

        fireEvent.change(timeRangeSelect(), {target: {value: 'custom'}});
        fireEvent.change(fromInput()!, {target: {value: '2026-10-01'}});
        fireEvent.change(toInput()!, {target: {value: '2026-10-17'}});

        fireEvent.change(timeRangeSelect(), {target: {value: 'today'}});

        // A hidden bound would keep narrowing the list with no way to see or
        // clear it, so leaving the mode has to drop both dates.
        expect(fromInput()).toBeNull();
        fireEvent.change(timeRangeSelect(), {target: {value: 'custom'}});
        expect((fromInput() as HTMLInputElement).value).toBe('');
        expect((toInput() as HTMLInputElement).value).toBe('');
    });

    it('resets the mode to All when the filters are cleared', () => {
        render(<PausableSection />);

        fireEvent.change(timeRangeSelect(), {target: {value: 'custom'}});
        fireEvent.change(fromInput()!, {target: {value: '2026-10-01'}});

        fireEvent.click(screen.getByRole('button', {name: 'sidebar.historyClearFilters'}));

        expect(timeRangeSelect().value).toBe('all');
        expect(fromInput()).toBeNull();
    });

    it('leaves no hidden database filter behind either', () => {
        renderSection(CONNECTION_A);

        fireEvent.change(databaseSelect(), {target: {value: 'db:sales'}});
        fireEvent.change(timeRangeSelect(), {target: {value: 'custom'}});
        // A window in the past, so the entries (all "now") match neither bound.
        fireEvent.change(fromInput()!, {target: {value: '2026-01-01'}});
        fireEvent.change(toInput()!, {target: {value: '2026-01-31'}});
        expect(visibleIds()).toEqual([]);

        fireEvent.click(screen.getByRole('button', {name: 'sidebar.historyClearFilters'}));

        expect(databaseSelect().value).toBe('all');
        expect(timeRangeSelect().value).toBe('all');
        expect(visibleIds()).toEqual(['a-sales', 'a-hr', 'a-legacy']);
    });
});

describe('QueryHistorySection custom date fields', () => {
    it('opens the native picker when a date field is clicked', () => {
        render(<PausableSection />);
        fireEvent.change(timeRangeSelect(), {target: {value: 'custom'}});
        const from = fromInput() as HTMLInputElement;
        const showPicker = vi.fn();
        from.showPicker = showPicker;

        fireEvent.click(from);

        // The native indicator is hidden to match the selects, so the click
        // is the way to reach the calendar.
        expect(showPicker).toHaveBeenCalledTimes(1);
    });

    it('keeps each label inside its field', () => {
        render(<PausableSection />);
        fireEvent.change(timeRangeSelect(), {target: {value: 'custom'}});

        const fromField = (fromInput() as HTMLInputElement).closest('label');
        const toField = (toInput() as HTMLInputElement).closest('label');

        expect(fromField).toHaveTextContent('sidebar.historyDateFrom');
        expect(toField).toHaveTextContent('sidebar.historyDateTo');
        expect(fromField).not.toBe(toField);
    });
});

describe('QueryHistorySection export', () => {
    beforeEach(() => {
        downloadFile.mockReset().mockResolvedValue(true);
    });

    it('downloads only matching entries in the order displayed by date groups', async () => {
        const entries = [
            {...entry, id: 'old', sql: 'SELECT old', executedAt: '2020-01-01T12:00:00Z'},
            {...entry, id: 'other-db', sql: 'SELECT excluded', database: 'other'},
            {...entry, id: 'new', sql: 'SELECT new', executedAt: new Date().toISOString()},
            {...entry, id: 'not-matching', sql: 'DELETE FROM users'},
        ];
        renderSection(entries);
        fireEvent.change(databaseSelect(), {target: {value: 'db:main'}});
        fireEvent.change(screen.getByPlaceholderText('sidebar.searchHistory'), {
            target: {value: 'SELECT'},
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'sidebar.exportHistory'}));
        });

        expect(downloadFile).toHaveBeenCalledTimes(1);
        const request = downloadFile.mock.calls[0][0];
        expect(request.fileName).toBe('query-history.sql');
        expect(request.mimeType).toBe('application/sql');
        const contents = new TextDecoder().decode(request.contents);
        expect(contents).toContain('-- 2020-01-01 21:00:00 · success · 12 ms');
        expect(contents).toContain('SELECT new;');
        expect(contents).toContain('SELECT old;');
        expect(contents.indexOf('SELECT new;')).toBeLessThan(contents.indexOf('SELECT old;'));
        expect(contents).not.toContain('SELECT excluded');
        expect(contents).not.toContain('DELETE FROM users');
    });

    it('disables export when filters leave no visible entries', () => {
        renderSection([entry]);
        fireEvent.change(screen.getByPlaceholderText('sidebar.searchHistory'), {
            target: {value: 'no match'},
        });
        expect(screen.getByRole('button', {name: 'sidebar.exportHistory'})).toBeDisabled();
        expect(downloadFile).not.toHaveBeenCalled();
    });

    it('reports a failed download and allows retrying', async () => {
        downloadFile.mockRejectedValueOnce(new Error('Disk full'));
        renderSection([entry]);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'sidebar.exportHistory'}));
        });
        expect(screen.getByRole('alert')).toHaveTextContent('sidebar.exportHistoryError');
        expect(screen.getByRole('alert')).toHaveTextContent('Disk full');

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'sidebar.exportHistory'}));
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(downloadFile).toHaveBeenCalledTimes(2);
    });

    it('blocks another export while saving and treats cancellation as normal', async () => {
        let finish: (saved: boolean) => void = () => {};
        downloadFile.mockReturnValueOnce(
            new Promise<boolean>((resolve) => {
                finish = resolve;
            }),
        );
        renderSection([entry]);
        fireEvent.click(screen.getByRole('button', {name: 'sidebar.exportHistory'}));
        expect(screen.getByRole('button', {name: 'sidebar.exportHistory'})).toBeDisabled();
        fireEvent.click(screen.getByRole('button', {name: 'sidebar.exportHistory'}));
        expect(downloadFile).toHaveBeenCalledTimes(1);
        await act(async () => {
            finish(false);
        });
        expect(screen.getByRole('button', {name: 'sidebar.exportHistory'})).toBeEnabled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

const minDurationInput = () =>
    screen.getByLabelText('sidebar.historyMinDurationFilter') as HTMLInputElement;
const clearFiltersButton = () => screen.getByRole('button', {name: 'sidebar.historyClearFilters'});

function timedEntry(id: string, executionTimeMs: number | null): QueryHistoryEntry {
    return {...makeEntry(id, 'main'), executionTimeMs};
}

const TIMED = [
    timedEntry('zero', 0),
    timedEntry('fast', 10),
    timedEntry('slow', 1500),
    timedEntry('unknown', null),
];

describe('QueryHistorySection minimum duration filter (#1397)', () => {
    it('shows every entry and no counter until a threshold is typed', () => {
        renderSection(TIMED);

        expect(minDurationInput().value).toBe('');
        expect(minDurationInput()).toHaveAttribute('aria-invalid', 'false');
        expect(visibleIds()).toEqual(['zero', 'fast', 'slow', 'unknown']);
        expect(screen.queryByText(/ \/ /)).not.toBeInTheDocument();
    });

    it('keeps entries at or above the threshold and shows the filtered counter', () => {
        renderSection(TIMED);

        fireEvent.change(minDurationInput(), {target: {value: '10'}});

        expect(visibleIds()).toEqual(['fast', 'slow']);
        expect(screen.getByText('2 / 4')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('treats zero as a threshold that hides entries without a duration', () => {
        renderSection(TIMED);

        fireEvent.change(minDurationInput(), {target: {value: '0'}});

        expect(visibleIds()).toEqual(['zero', 'fast', 'slow']);
        expect(screen.getByText('3 / 4')).toBeInTheDocument();
    });

    it('explains a negative threshold and matches nothing', () => {
        renderSection(TIMED);

        fireEvent.change(minDurationInput(), {target: {value: '-5'}});

        expect(screen.getByRole('alert')).toHaveTextContent('sidebar.historyMinDurationNegative');
        expect(minDurationInput()).toHaveAttribute('aria-invalid', 'true');
        expect(visibleIds()).toEqual([]);
        expect(screen.getByText('0 / 4')).toBeInTheDocument();
    });

    it('explains a nonnumeric threshold and keeps what was typed', () => {
        renderSection(TIMED);

        fireEvent.change(minDurationInput(), {target: {value: '5 seconds'}});

        // The text stays so the user can see and fix it, unlike a number input
        // that would silently drop it.
        expect(minDurationInput().value).toBe('5 seconds');
        expect(screen.getByRole('alert')).toHaveTextContent('sidebar.historyMinDurationInvalid');
        expect(visibleIds()).toEqual([]);

        fireEvent.change(minDurationInput(), {target: {value: '5'}});
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(visibleIds()).toEqual(['fast', 'slow']);
    });

    it('combines with the outcome filter and clears with the other filters', () => {
        renderSection([...TIMED, {...timedEntry('slow-failure', 3000), status: 'error'}]);

        fireEvent.change(minDurationInput(), {target: {value: '1000'}});
        fireEvent.change(screen.getByRole('combobox', {name: 'sidebar.historyOutcomeFilter'}), {
            target: {value: 'failed'},
        });
        expect(visibleIds()).toEqual(['slow-failure']);
        expect(screen.getByText('1 / 5')).toBeInTheDocument();

        fireEvent.click(clearFiltersButton());

        expect(minDurationInput().value).toBe('');
        expect(visibleIds()).toEqual(['zero', 'fast', 'slow', 'unknown', 'slow-failure']);
        expect(screen.queryByText(/ \/ /)).not.toBeInTheDocument();
    });

    it('keeps its label inside the field', () => {
        renderSection(TIMED);

        const field = minDurationInput().closest('label');
        expect(field).toHaveTextContent('sidebar.historyMinDuration');
        expect(field).toHaveTextContent('sidebar.historyMinDurationUnit');
    });
});

describe('QueryHistorySection insights view (#1413)', () => {
    it('aggregates query shapes, highlights regressions, discloses coverage/missing durations, and drills into contributing executions', () => {
        const nowMs = Date.now();
        const hoursAgoIso = (h: number) => new Date(nowMs - h * 3600 * 1000).toISOString();
        const onDoubleClick = vi.fn();

        const insightEntries: QueryHistoryEntry[] = [
            // Current 7d window: 3 timed samples (avg 120ms) + 1 untimed execution
            {
                id: 'cur-1',
                sql: "SELECT * FROM orders WHERE status = 'open' AND customer_id = 10",
                executedAt: hoursAgoIso(1),
                executionTimeMs: 110,
                status: 'success',
                rowsAffected: 5,
                error: null,
                database: 'sales',
            },
            {
                id: 'cur-2',
                sql: "SELECT * FROM orders WHERE status = 'paid' AND customer_id = 11",
                executedAt: hoursAgoIso(2),
                executionTimeMs: 120,
                status: 'success',
                rowsAffected: 2,
                error: null,
                database: 'sales',
            },
            {
                id: 'cur-3',
                sql: "SELECT * FROM orders WHERE status = 'shipped' AND customer_id = 12",
                executedAt: hoursAgoIso(3),
                executionTimeMs: 130,
                status: 'success',
                rowsAffected: 1,
                error: null,
                database: 'sales',
            },
            {
                id: 'cur-untimed',
                sql: "SELECT * FROM orders WHERE status = 'failed' AND customer_id = 13",
                executedAt: hoursAgoIso(4),
                executionTimeMs: null,
                status: 'error',
                rowsAffected: null,
                error: 'cancelled',
                database: 'sales',
            },
            // Prior 7d window (8..10 days ago): 3 timed samples (avg 30ms)
            {
                id: 'pri-1',
                sql: "SELECT * FROM orders WHERE status = 'open' AND customer_id = 1",
                executedAt: hoursAgoIso(24 * 8),
                executionTimeMs: 25,
                status: 'success',
                rowsAffected: 1,
                error: null,
                database: 'sales',
            },
            {
                id: 'pri-2',
                sql: "SELECT * FROM orders WHERE status = 'open' AND customer_id = 2",
                executedAt: hoursAgoIso(24 * 9),
                executionTimeMs: 30,
                status: 'success',
                rowsAffected: 1,
                error: null,
                database: 'sales',
            },
            {
                id: 'pri-3',
                sql: "SELECT * FROM orders WHERE status = 'open' AND customer_id = 3",
                executedAt: hoursAgoIso(24 * 10),
                executionTimeMs: 35,
                status: 'success',
                rowsAffected: 1,
                error: null,
                database: 'sales',
            },
            // Second shape: insufficient samples (only 1 sample in current window)
            {
                id: 'single-1',
                sql: 'SELECT id FROM customers WHERE active = 1',
                executedAt: hoursAgoIso(5),
                executionTimeMs: 15,
                status: 'success',
                rowsAffected: 1,
                error: null,
                database: 'sales',
            },
        ];

        render(
            <QueryHistorySection
                entries={insightEntries}
                isLoading={false}
                recoveryNotice={null}
                onDismissRecoveryNotice={vi.fn()}
                onDoubleClick={onDoubleClick}
                onContextMenu={vi.fn()}
                onClearAll={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole('button', {name: 'sidebar.historyViewInsights'}));

        // Client-observed timing disclosure & missing-duration disclosure
        expect(screen.getByText('sidebar.historyInsightsClientObservedNote')).toBeInTheDocument();
        expect(screen.getByText('sidebar.historyInsightsMissingDurationsNote')).toBeInTheDocument();

        // Both normalized shapes are shown initially
        expect(
            screen.getByText("SELECT * FROM orders WHERE status = '?' AND customer_id = ?"),
        ).toBeInTheDocument();
        expect(screen.getByText('SELECT id FROM customers WHERE active = ?')).toBeInTheDocument();

        // Filter to regressions only -> hides the 1-sample query shape
        const regressionsToggle = screen.getByRole('button', {
            name: 'sidebar.historyInsightsRegressionsOnly',
        });
        fireEvent.click(regressionsToggle);
        expect(regressionsToggle).toHaveAttribute('aria-pressed', 'true');
        expect(
            screen.queryByText('SELECT id FROM customers WHERE active = ?'),
        ).not.toBeInTheDocument();
        expect(
            screen.getByText("SELECT * FROM orders WHERE status = '?' AND customer_id = ?"),
        ).toBeInTheDocument();

        // Expand contributing executions and load one into the editor
        const drilldownBtn = screen.getByRole('button', {
            name: 'sidebar.historyInsightsContributingExecutions',
        });
        expect(drilldownBtn).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(drilldownBtn);
        expect(drilldownBtn).toHaveAttribute('aria-expanded', 'true');

        const firstExecutionButton = screen.getByTitle(
            "SELECT * FROM orders WHERE status = 'open' AND customer_id = 10",
        );
        fireEvent.doubleClick(firstExecutionButton);
        expect(onDoubleClick).toHaveBeenCalledWith(insightEntries[0]);
    });

    it('fetches backend insights via get_query_history_insights when TabularisClient and connectionId are present', async () => {
        const call = vi.fn().mockResolvedValue({
            groups: [],
            coverage: {
                currentWindowStart: '2026-10-31T00:00:00Z',
                currentWindowEnd: '2026-11-07T00:00:00Z',
                priorWindowStart: '2026-10-24T00:00:00Z',
                priorWindowEnd: '2026-10-31T00:00:00Z',
                totalStoredExecutions: 500,
                maxStoredExecutions: 500,
                retentionCapReached: true,
                oldestRecordedAt: '2026-10-29T00:00:00Z',
                priorWindowFullyCovered: false,
                currentWindowExecutions: 12,
                currentWindowMissingDurationCount: 0,
                priorWindowExecutions: 4,
                priorWindowMissingDurationCount: 0,
            },
            policy: {
                minRegressionSamples: 3,
                minRegressionDeltaMs: 10,
                minRegressionRatio: 0.25,
                timingSource: 'client-observed',
            },
        });
        const mockClient = {call} as unknown as TabularisClient;

        render(
            <TabularisClientContext.Provider value={mockClient}>
                <QueryHistorySection
                    connectionId="conn-postgres-1"
                    dialect="postgres"
                    entries={[entry]}
                    isLoading={false}
                    recoveryNotice={null}
                    onDismissRecoveryNotice={vi.fn()}
                    onDoubleClick={vi.fn()}
                    onContextMenu={vi.fn()}
                    onClearAll={vi.fn()}
                />
            </TabularisClientContext.Provider>,
        );

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'sidebar.historyViewInsights'}));
        });

        expect(call).toHaveBeenCalledWith('get_query_history_insights', {
            connectionId: 'conn-postgres-1',
            database: 'all',
            windowHours: 168,
            dialect: 'postgres',
        });
        expect(screen.getByText('sidebar.historyInsightsRetentionCapWarning')).toBeInTheDocument();
    });

    it('shows a warning alert when backend insights call fails and gracefully uses local preview', async () => {
        const call = vi.fn().mockRejectedValue(new Error('RPC network timeout'));
        const mockClient = {call} as unknown as TabularisClient;
        const recentEntry = {
            ...entry,
            executedAt: new Date().toISOString(),
        };

        render(
            <TabularisClientContext.Provider value={mockClient}>
                <QueryHistorySection
                    connectionId="conn-postgres-1"
                    dialect="postgres"
                    entries={[recentEntry]}
                    isLoading={false}
                    recoveryNotice={null}
                    onDismissRecoveryNotice={vi.fn()}
                    onDoubleClick={vi.fn()}
                    onContextMenu={vi.fn()}
                    onClearAll={vi.fn()}
                />
            </TabularisClientContext.Provider>,
        );

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'sidebar.historyViewInsights'}));
        });

        expect(screen.getByText('sidebar.historyInsightsBackendError')).toBeInTheDocument();
        expect(screen.getByText('SELECT ?')).toBeInTheDocument();
    });

    it('does not retain connection A insights when switching to connection B with pending response', async () => {
        let resolveB: (val: any) => void = () => {};
        const pendingPromiseB = new Promise((resolve) => {
            resolveB = resolve;
        });

        const entryA: QueryHistoryEntry = {
            id: 'entry-a',
            sql: 'SELECT 1 FROM conn_a_table',
            executedAt: new Date().toISOString(),
            status: 'success',
            durationMs: 10,
        };
        const entryB: QueryHistoryEntry = {
            id: 'entry-b',
            sql: 'SELECT 1 FROM conn_b_table',
            executedAt: new Date().toISOString(),
            status: 'success',
            durationMs: 15,
        };

        const call = vi.fn().mockImplementation((method: string, args: any) => {
            if (args.connectionId === 'conn-A') {
                return Promise.resolve({
                    groups: [
                        {
                            fingerprint: 'fp-unique-conn-A',
                            statementKind: 'SELECT',
                            sampleQuery: 'SELECT * FROM unique_conn_a_table',
                            callCount: 10,
                            totalDurationMs: 1000,
                            avgDurationMs: 100,
                            minDurationMs: 50,
                            maxDurationMs: 200,
                            failureCount: 0,
                            failureRate: 0,
                            currentWindowCallCount: 10,
                            currentWindowTimedCount: 10,
                            currentWindowAvgMs: 100,
                            priorWindowCallCount: 10,
                            priorWindowTimedCount: 10,
                            priorWindowAvgMs: 100,
                            deltaAvgMs: 0,
                            relativeDeltaAvg: 0,
                            regressionStatus: 'stable',
                            contributingExecutions: [],
                        },
                    ],
                    coverage: {
                        currentWindowStart: '2026-10-31T00:00:00Z',
                        currentWindowEnd: '2026-11-07T00:00:00Z',
                        priorWindowStart: '2026-10-24T00:00:00Z',
                        priorWindowEnd: '2026-10-31T00:00:00Z',
                        totalStoredExecutions: 10,
                        maxStoredExecutions: 500,
                        retentionCapReached: false,
                        currentWindowExecutions: 10,
                        currentWindowMissingDurationCount: 0,
                        priorWindowExecutions: 10,
                        priorWindowMissingDurationCount: 0,
                        priorWindowFullyCovered: true,
                    },
                });
            }
            if (args.connectionId === 'conn-B') {
                return pendingPromiseB;
            }
            return Promise.resolve({groups: [], coverage: {}});
        });

        const mockClient = {call} as unknown as TabularisClient;

        const {rerender} = render(
            <TabularisClientContext.Provider value={mockClient}>
                <QueryHistorySection
                    connectionId="conn-A"
                    dialect="postgres"
                    entries={[entryA]}
                    isLoading={false}
                    recoveryNotice={null}
                    onDismissRecoveryNotice={vi.fn()}
                    onDoubleClick={vi.fn()}
                    onContextMenu={vi.fn()}
                    onClearAll={vi.fn()}
                />
            </TabularisClientContext.Provider>,
        );

        // Switch to insights mode for conn-A
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'sidebar.historyViewInsights'}));
        });

        // Connection A insights should be loaded and visible
        expect(screen.getByText('fp-unique-conn-A')).toBeInTheDocument();

        // Switch to connection B whose backend insights promise is unresolved
        await act(async () => {
            rerender(
                <TabularisClientContext.Provider value={mockClient}>
                    <QueryHistorySection
                        connectionId="conn-B"
                        dialect="postgres"
                        entries={[entryB]}
                        isLoading={false}
                        recoveryNotice={null}
                        onDismissRecoveryNotice={vi.fn()}
                        onDoubleClick={vi.fn()}
                        onContextMenu={vi.fn()}
                        onClearAll={vi.fn()}
                    />
                </TabularisClientContext.Provider>,
            );
        });

        // Connection A values must no longer be displayed under connection B!
        expect(screen.queryByText('fp-unique-conn-A')).not.toBeInTheDocument();

        // Clean up pending promise wrapped in act
        await act(async () => {
            resolveB({groups: [], coverage: {}});
        });
    });

    it('clears previous error on subsequent success and clears previous success on subsequent error', async () => {
        let shouldFailA = true;
        const entryA: QueryHistoryEntry = {
            id: 'entry-a',
            sql: 'SELECT 1 FROM table_a',
            executedAt: new Date().toISOString(),
            status: 'success',
            durationMs: 10,
        };

        const successDataA = {
            groups: [
                {
                    fingerprint: 'fp-success-conn-A',
                    statementKind: 'SELECT',
                    sampleQuery: 'SELECT * FROM table_a',
                    callCount: 5,
                    totalDurationMs: 50,
                    avgDurationMs: 10,
                    minDurationMs: 5,
                    maxDurationMs: 15,
                    failureCount: 0,
                    failureRate: 0,
                    currentWindowCallCount: 5,
                    currentWindowTimedCount: 5,
                    currentWindowAvgMs: 10,
                    priorWindowCallCount: 5,
                    priorWindowTimedCount: 5,
                    priorWindowAvgMs: 10,
                    deltaAvgMs: 0,
                    relativeDeltaAvg: 0,
                    regressionStatus: 'stable' as const,
                    contributingExecutions: [],
                },
            ],
            coverage: {
                currentWindowStart: '2026-10-31T00:00:00Z',
                currentWindowEnd: '2026-11-07T00:00:00Z',
                priorWindowStart: '2026-10-24T00:00:00Z',
                priorWindowEnd: '2026-10-31T00:00:00Z',
                totalStoredExecutions: 5,
                maxStoredExecutions: 500,
                retentionCapReached: false,
                currentWindowExecutions: 5,
                currentWindowMissingDurationCount: 0,
                priorWindowExecutions: 5,
                priorWindowMissingDurationCount: 0,
                priorWindowFullyCovered: true,
            },
        };

        const call = vi.fn().mockImplementation((method: string, args: any) => {
            if (args.connectionId === 'conn-A') {
                if (shouldFailA) {
                    return Promise.reject(new Error('Backend offline'));
                }
                return Promise.resolve(successDataA);
            }
            return Promise.resolve({groups: [], coverage: {}});
        });

        const mockClient = {call} as unknown as TabularisClient;

        const {rerender} = render(
            <TabularisClientContext.Provider value={mockClient}>
                <QueryHistorySection
                    connectionId="conn-A"
                    dialect="postgres"
                    entries={[entryA]}
                    isLoading={false}
                    recoveryNotice={null}
                    onDismissRecoveryNotice={vi.fn()}
                    onDoubleClick={vi.fn()}
                    onContextMenu={vi.fn()}
                    onClearAll={vi.fn()}
                />
            </TabularisClientContext.Provider>,
        );

        // Open insights: conn-A fails first
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'sidebar.historyViewInsights'}));
        });

        expect(screen.getByText('sidebar.historyInsightsBackendError')).toBeInTheDocument();
        expect(screen.queryByText('fp-success-conn-A')).not.toBeInTheDocument();

        // Switch to conn-B
        await act(async () => {
            rerender(
                <TabularisClientContext.Provider value={mockClient}>
                    <QueryHistorySection
                        connectionId="conn-B"
                        dialect="postgres"
                        entries={[]}
                        isLoading={false}
                        recoveryNotice={null}
                        onDismissRecoveryNotice={vi.fn()}
                        onDoubleClick={vi.fn()}
                        onContextMenu={vi.fn()}
                        onClearAll={vi.fn()}
                    />
                </TabularisClientContext.Provider>,
            );
        });

        // Now conn-A will succeed
        shouldFailA = false;

        // Switch back to conn-A
        await act(async () => {
            rerender(
                <TabularisClientContext.Provider value={mockClient}>
                    <QueryHistorySection
                        connectionId="conn-A"
                        dialect="postgres"
                        entries={[entryA]}
                        isLoading={false}
                        recoveryNotice={null}
                        onDismissRecoveryNotice={vi.fn()}
                        onDoubleClick={vi.fn()}
                        onContextMenu={vi.fn()}
                        onClearAll={vi.fn()}
                    />
                </TabularisClientContext.Provider>,
            );
        });

        // Previous error must be cleared, and success data shown!
        expect(screen.queryByText('sidebar.historyInsightsBackendError')).not.toBeInTheDocument();
        expect(screen.getByText('fp-success-conn-A')).toBeInTheDocument();

        // Now test the inverse: conn-A subsequently fails
        shouldFailA = true;

        // Switch away to conn-B and back to conn-A
        await act(async () => {
            rerender(
                <TabularisClientContext.Provider value={mockClient}>
                    <QueryHistorySection
                        connectionId="conn-B"
                        dialect="postgres"
                        entries={[]}
                        isLoading={false}
                        recoveryNotice={null}
                        onDismissRecoveryNotice={vi.fn()}
                        onDoubleClick={vi.fn()}
                        onContextMenu={vi.fn()}
                        onClearAll={vi.fn()}
                    />
                </TabularisClientContext.Provider>,
            );
        });

        await act(async () => {
            rerender(
                <TabularisClientContext.Provider value={mockClient}>
                    <QueryHistorySection
                        connectionId="conn-A"
                        dialect="postgres"
                        entries={[entryA]}
                        isLoading={false}
                        recoveryNotice={null}
                        onDismissRecoveryNotice={vi.fn()}
                        onDoubleClick={vi.fn()}
                        onContextMenu={vi.fn()}
                        onClearAll={vi.fn()}
                    />
                </TabularisClientContext.Provider>,
            );
        });

        // Old success data must be cleared, and error alert displayed!
        expect(screen.getByText('sidebar.historyInsightsBackendError')).toBeInTheDocument();
        expect(screen.queryByText('fp-success-conn-A')).not.toBeInTheDocument();
    });
});
