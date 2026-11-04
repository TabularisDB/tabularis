import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {useState, type ComponentProps} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {QueryHistorySection} from '@/components/layout/sidebar/QueryHistorySection';
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
