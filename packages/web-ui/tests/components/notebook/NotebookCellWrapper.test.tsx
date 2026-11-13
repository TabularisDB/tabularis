import type {ComponentProps} from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {invoke} from '@tauri-apps/api/core';
import {parsePostgresJson} from '@tabularis/explain';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NotebookCellWrapper} from '../../../src/components/notebook/NotebookCellWrapper';
import {duplicateCell} from '@/utils/notebook';
import type {SqlCellEditor} from '../../../src/components/notebook/SqlCellEditor';
import type {VisualExplainViewProps} from '../../../src/components/explain/VisualExplainView';

vi.mock('@/hooks/useTabularisClient', () => import('../../support/tauriBackedHooks'));
vi.mock('@/hooks/usePlatformCapabilities', () => import('../../support/tauriBackedHooks'));
const database = vi.hoisted(() => ({
    getConnectionData: vi.fn(),
    capabilities: {explain: false},
}));
vi.mock('react-i18next', () => {
    const t = (key: string, options?: {refs?: string}) =>
        options?.refs ? `${key}: ${options.refs}` : key;
    return {useTranslation: () => ({t})};
});
vi.mock('lucide-react', () => vi.importActual('lucide-react'));
vi.mock('../../../src/hooks/useDatabase', () => ({
    useDatabase: () => ({...database, connections: []}),
}));
vi.mock('../../../src/hooks/useSettings', () => ({
    useSettings: () => ({settings: {aiEnabled: false}}),
}));
vi.mock('../../../src/hooks/useDrivers', () => ({
    useDrivers: () => ({allDrivers: []}),
}));
vi.mock('../../../src/utils/driverUI', () => ({getConnectionIcon: () => null}));
vi.mock('../../../src/components/notebook/CellNameAiButton', () => ({
    CellNameAiButton: () => null,
}));
vi.mock('../../../src/components/notebook/CellHistoryPanel', () => ({
    CellHistoryPanel: () => null,
}));
vi.mock('../../../src/components/notebook/MarkdownCell', () => ({
    MarkdownCell: () => <div data-testid="markdown">Markdown content</div>,
}));
vi.mock('../../../src/components/notebook/SqlCellEditor', () => ({
    SqlCellEditor: (props: ComponentProps<typeof SqlCellEditor>) => (
        <textarea
            aria-label="SQL editor"
            readOnly
            value={props.content}
            data-schema={props.schema}
        />
    ),
}));
vi.mock('../../../src/components/notebook/SqlCellResult', () => ({SqlCellResult: () => null}));
vi.mock('../../../src/components/explain/VisualExplainView', () => ({
    VisualExplainView: (props: VisualExplainViewProps) => (
        <section data-testid="explain-view">
            {props.plan && <div data-testid="plan">{props.plan.root.node_type}</div>}
            {props.error && <div role="alert">{props.error}</div>}
            {props.isLoading && <div data-testid="loading">Loading</div>}
        </section>
    ),
}));

const mockInvoke = vi.mocked(invoke);

function makeProps(): ComponentProps<typeof NotebookCellWrapper> {
    return {
        cell: {id: 'cell-2', type: 'sql', content: 'SELECT * FROM widgets'},
        index: 1,
        totalCells: 3,
        connectionId: 'cell-connection',
        activeSchema: 'analytics',
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        onMoveUp: vi.fn(),
        onMoveDown: vi.fn(),
        onRun: vi.fn(),
    };
}

async function settle() {
    await act(async () => {
        await Promise.resolve();
    });
}

describe('NotebookCellWrapper query plans', () => {
    beforeEach(() => {
        mockInvoke.mockReset().mockResolvedValue({
            kind: 'plan',
            plan: parsePostgresJson('[{"Plan":{"Node Type":"Result"}}]'),
        });
        database.capabilities = {explain: false};
        database.getConnectionData.mockReset().mockImplementation((id: string) => {
            if (id === 'not-loaded') return undefined;
            return {capabilities: {explain: id !== 'unsupported'}, driver: 'postgres'};
        });
    });

    it.each([
        {connectionId: 'cell-connection', activeExplain: false, hasToggle: true},
        {connectionId: 'unsupported', activeExplain: true, hasToggle: false},
        {connectionId: 'not-loaded', activeExplain: true, hasToggle: false},
    ])(
        'gates the toggle by $connectionId rather than active capabilities',
        async ({connectionId, activeExplain, hasToggle}) => {
            database.capabilities = {explain: activeExplain};
            render(<NotebookCellWrapper {...makeProps()} connectionId={connectionId} />);
            await settle();
            const toggle = screen.queryByRole('button', {name: 'editor.notebook.toggleQueryPlan'});
            if (hasToggle) expect(toggle).toHaveAttribute('aria-pressed', 'false');
            else expect(toggle).not.toBeInTheDocument();
            expect(database.getConnectionData).toHaveBeenCalledWith(connectionId);
            expect(mockInvoke).not.toHaveBeenCalled();
        },
    );

    it('persists visibility through onUpdate and reuses the plan after toggling off and on', async () => {
        const props = makeProps();
        const {rerender} = render(<NotebookCellWrapper {...props} />);
        const toggle = screen.getByRole('button', {name: 'editor.notebook.toggleQueryPlan'});
        fireEvent.click(toggle);
        expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({isQueryPlanVisible: true});
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(mockInvoke).not.toHaveBeenCalled();
        rerender(
            <NotebookCellWrapper {...props} cell={{...props.cell, isQueryPlanVisible: true}} />,
        );
        await settle();
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        expect(toggle).toHaveAccessibleName('editor.notebook.hideQueryPlan');
        expect(toggle).toHaveAttribute('title', 'editor.notebook.hideQueryPlan');
        expect(screen.getByTestId('plan')).toBeInTheDocument();
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        fireEvent.click(toggle);
        expect(props.onUpdate).toHaveBeenLastCalledWith({isQueryPlanVisible: false});
        rerender(
            <NotebookCellWrapper {...props} cell={{...props.cell, isQueryPlanVisible: false}} />,
        );
        await settle();
        expect(screen.queryByTestId('explain-view')).not.toBeInTheDocument();
        fireEvent.click(toggle);
        expect(props.onUpdate).toHaveBeenLastCalledWith({isQueryPlanVisible: true});
        rerender(
            <NotebookCellWrapper {...props} cell={{...props.cell, isQueryPlanVisible: true}} />,
        );
        await settle();
        expect(screen.getByTestId('plan')).toBeInTheDocument();
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(props.onRun).not.toHaveBeenCalled();
    });

    it('persists hiding from the inline section header through the same onUpdate path', async () => {
        const props = makeProps();
        const {rerender} = render(
            <NotebookCellWrapper {...props} cell={{...props.cell, isQueryPlanVisible: true}} />,
        );
        await settle();
        fireEvent.click(screen.getByRole('button', {name: 'editor.notebook.sectionQueryPlan'}));
        expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({isQueryPlanVisible: false});
        rerender(
            <NotebookCellWrapper {...props} cell={{...props.cell, isQueryPlanVisible: false}} />,
        );
        await settle();
        const toggle = screen.getByRole('button', {name: 'editor.notebook.toggleQueryPlan'});
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(toggle).toHaveAttribute('title', 'editor.notebook.toggleQueryPlan');
        expect(screen.queryByTestId('explain-view')).not.toBeInTheDocument();
        expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('never offers a query plan or run button for markdown even with persisted visibility', async () => {
        const props = makeProps();
        render(
            <NotebookCellWrapper
                {...props}
                cell={{...props.cell, type: 'markdown', isQueryPlanVisible: true}}
            />,
        );
        await settle();
        expect(screen.getByTestId('markdown')).toBeInTheDocument();
        expect(
            screen.queryByRole('button', {name: 'editor.notebook.toggleQueryPlan'}),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', {name: 'editor.notebook.runCell'}),
        ).not.toBeInTheDocument();
        expect(screen.queryByTestId('explain-view')).not.toBeInTheDocument();
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it.each(['reporting', undefined])(
        'forwards resolved SQL and effective schema %s into the real explain hook',
        async (activeSchema) => {
            const props = makeProps();
            const raw = 'SELECT * FROM {{cell_1}}';
            const sql = 'WITH cell_1 AS (SELECT 42 AS id) SELECT * FROM cell_1';
            render(
                <NotebookCellWrapper
                    {...props}
                    activeSchema={activeSchema}
                    cell={{
                        ...props.cell,
                        content: raw,
                        schema: 'stored-schema',
                        isQueryPlanVisible: true,
                    }}
                    explainQuery={{sql, unresolvedRefs: []}}
                />,
            );
            await settle();
            expect(screen.getByRole('textbox', {name: 'SQL editor'})).toHaveValue(raw);
            expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('explain_query_plan', {
                connectionId: 'cell-connection',
                query: sql,
                schema: activeSchema ?? undefined,
                analyze: false,
                database: undefined,
            });
            expect(screen.getByTestId('plan')).toHaveTextContent('Result');
        },
    );

    it('does not mount or invoke a persisted query plan while the whole cell is collapsed', async () => {
        const props = makeProps();
        const cell = {...props.cell, isCollapsed: true, isQueryPlanVisible: true};
        const {rerender} = render(<NotebookCellWrapper {...props} cell={cell} />);
        await settle();
        expect(screen.queryByTestId('explain-view')).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', {name: 'SQL editor'})).not.toBeInTheDocument();
        rerender(<NotebookCellWrapper {...props} cell={cell} activeSchema="reporting" />);
        await settle();
        expect(mockInvoke).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTitle('editor.notebook.expandCell'));
        expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({isCollapsed: false});
        expect(mockInvoke).not.toHaveBeenCalled();
        rerender(
            <NotebookCellWrapper
                {...props}
                activeSchema="reporting"
                cell={{...cell, isCollapsed: false}}
            />,
        );
        await settle();
        expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('explain_query_plan', {
            connectionId: 'cell-connection',
            query: props.cell.content,
            schema: 'reporting',
            analyze: false,
            database: undefined,
        });
    });

    it('forwards schema changes without automatically executing a new plan', async () => {
        const props = makeProps();
        const cell = {...props.cell, isQueryPlanVisible: true};
        const onSchemaChange = vi.fn();
        const {rerender} = render(
            <NotebookCellWrapper
                {...props}
                cell={cell}
                selectedDatabases={['analytics', 'reporting']}
                onSchemaChange={onSchemaChange}
            />,
        );
        await settle();
        fireEvent.click(screen.getByTitle('editor.activeDatabase'));
        fireEvent.click(screen.getByRole('button', {name: 'reporting'}));
        expect(onSchemaChange).toHaveBeenCalledExactlyOnceWith('reporting');
        rerender(
            <NotebookCellWrapper
                {...props}
                cell={cell}
                activeSchema="reporting"
                selectedDatabases={['analytics', 'reporting']}
                onSchemaChange={onSchemaChange}
            />,
        );
        await settle();
        expect(screen.queryByTestId('plan')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('editor.notebook.queryPlanOutdated');
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        await act(async () => {
            fireEvent.click(screen.getByTitle('editor.visualExplain.rerun'));
        });
        expect(mockInvoke).toHaveBeenCalledTimes(2);
        expect(mockInvoke).toHaveBeenLastCalledWith('explain_query_plan', {
            connectionId: 'cell-connection',
            query: props.cell.content,
            schema: 'reporting',
            analyze: false,
            database: undefined,
        });
    });

    it('blocks unresolved cell references until the first valid resolved query is supplied', async () => {
        const props = makeProps();
        const cell = {...props.cell, content: 'SELECT * FROM {{cell_1}}', isQueryPlanVisible: true};
        const {rerender} = render(
            <NotebookCellWrapper
                {...props}
                cell={cell}
                explainQuery={{
                    sql: cell.content,
                    unresolvedRefs: [{match: '{{cell_1}}', cellIndex: 0}],
                }}
            />,
        );
        await settle();
        expect(screen.getByRole('alert')).toHaveTextContent(
            'editor.notebook.queryPlanUnresolved: {{cell_1}}',
        );
        expect(screen.getByTitle('editor.visualExplain.rerun')).toBeDisabled();
        expect(mockInvoke).not.toHaveBeenCalled();
        rerender(
            <NotebookCellWrapper
                {...props}
                cell={cell}
                explainQuery={{sql: 'SELECT 42', unresolvedRefs: []}}
            />,
        );
        await settle();
        expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('explain_query_plan', {
            connectionId: 'cell-connection',
            query: 'SELECT 42',
            schema: 'analytics',
            analyze: false,
            database: undefined,
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('NotebookCellWrapper duplicate action', () => {
    const label = 'editor.notebook.duplicateCellToEnd';

    beforeEach(() => {
        mockInvoke.mockReset().mockResolvedValue({
            kind: 'plan',
            plan: parsePostgresJson('[{"Plan":{"Node Type":"Result"}}]'),
        });
        database.getConnectionData.mockReset().mockReturnValue({
            capabilities: {explain: true},
            driver: 'postgres',
        });
    });

    it.each(['sql', 'markdown'] as const)(
        'offers a labelled duplicate button on %s cells',
        (type) => {
            const onDuplicate = vi.fn();
            const props = makeProps();
            render(
                <NotebookCellWrapper
                    {...props}
                    cell={{...props.cell, type}}
                    onDuplicate={onDuplicate}
                    canDuplicate
                />,
            );
            const button = screen.getByRole('button', {name: label});
            expect(button).toHaveAttribute('title', label);
            expect(button).toBeEnabled();
            fireEvent.click(button);
            expect(onDuplicate).toHaveBeenCalledTimes(1);
            expect(props.onRun).not.toHaveBeenCalled();
        },
    );

    it('is disabled when duplication is not allowed', () => {
        const onDuplicate = vi.fn();
        render(
            <NotebookCellWrapper {...makeProps()} onDuplicate={onDuplicate} canDuplicate={false} />,
        );
        const button = screen.getByRole('button', {name: label});
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(onDuplicate).not.toHaveBeenCalled();
    });

    it('does not fetch a query plan for the copy of a cell whose plan is open', async () => {
        const props = makeProps();
        const source = {...props.cell, isQueryPlanVisible: true, result: null};
        const explainQuery = {sql: source.content, unresolvedRefs: []};

        // Control: the open plan of the original is fetched on mount.
        const {unmount} = render(
            <NotebookCellWrapper {...props} cell={source} explainQuery={explainQuery} />,
        );
        await settle();
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        unmount();
        mockInvoke.mockClear();

        const copy = duplicateCell(source);
        render(<NotebookCellWrapper {...props} cell={copy} explainQuery={explainQuery} />);
        await settle();
        expect(mockInvoke).not.toHaveBeenCalled();
        expect(screen.queryByTestId('explain-view')).not.toBeInTheDocument();
        expect(copy.isQueryPlanVisible).toBe(false);
    });

    it('is hidden without a duplicate handler', () => {
        render(<NotebookCellWrapper {...makeProps()} />);
        expect(screen.queryByRole('button', {name: label})).not.toBeInTheDocument();
    });
});

describe('NotebookCellWrapper enable/disable toggle', () => {
    const disableLabel = 'editor.notebook.disableCell';
    const enableLabel = 'editor.notebook.enableCell';

    beforeEach(() => {
        mockInvoke.mockReset();
        database.getConnectionData.mockReset().mockReturnValue({
            capabilities: {explain: true},
            driver: 'postgres',
        });
    });

    it('defaults a legacy SQL cell to enabled and disables it through onUpdate', () => {
        const props = makeProps();
        render(<NotebookCellWrapper {...props} />);
        const toggle = screen.getByRole('button', {name: disableLabel});
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', {name: 'editor.notebook.runCell'})).toBeEnabled();
        expect(screen.queryByText('editor.notebook.cellDisabled')).not.toBeInTheDocument();
        fireEvent.click(toggle);
        expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({isDisabled: true});
        expect(props.onRun).not.toHaveBeenCalled();
    });

    it('shows the disabled state, explains why run is off and re-enables without running', async () => {
        const props = makeProps();
        render(
            <NotebookCellWrapper
                {...props}
                cell={{...props.cell, isDisabled: true, isQueryPlanVisible: true}}
            />,
        );
        await settle();
        const toggle = screen.getByRole('button', {name: enableLabel});
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        const run = screen.getByRole('button', {name: 'editor.notebook.runDisabledReason'});
        expect(run).toBeDisabled();
        expect(run).toHaveAttribute('title', 'editor.notebook.runDisabledReason');
        expect(screen.getByText('editor.notebook.cellDisabled')).toBeInTheDocument();
        // The plan toggle stays in place but is off, and no EXPLAIN is sent while disabled,
        // even with the plan left open.
        expect(screen.getByRole('button', {name: 'editor.notebook.hideQueryPlan'})).toBeDisabled();
        expect(screen.queryByTestId('explain-view')).not.toBeInTheDocument();
        expect(mockInvoke).not.toHaveBeenCalled();

        fireEvent.click(toggle);
        expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({isDisabled: undefined});
        expect(props.onRun).not.toHaveBeenCalled();
    });

    it('offers no toggle on Markdown cells', () => {
        render(
            <NotebookCellWrapper
                {...makeProps()}
                cell={{id: 'md', type: 'markdown', content: '# Notes', isDisabled: true}}
            />,
        );
        expect(screen.queryByRole('button', {name: disableLabel})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: enableLabel})).not.toBeInTheDocument();
        expect(screen.queryByText('editor.notebook.cellDisabled')).not.toBeInTheDocument();
    });
});
