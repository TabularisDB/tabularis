import {useState, type ReactNode} from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {Edge, Node} from '@xyflow/react';
import type {TableSchema} from '@/types/editor';

const mocks = vi.hoisted(() => ({
    getSchema: vi.fn(),
    showAlert: vi.fn(),
    downloadTextFile: vi.fn(),
    // Hook results must keep their identity across renders: the diagram lists
    // them as effect dependencies, so fresh objects would reload it forever.
    reactFlow: {fitView: () => {}, zoomIn: () => {}, zoomOut: () => {}},
    searchParams: new URLSearchParams(),
    settings: {settings: {}},
    platform: {},
}));

// React Flow measures the DOM and draws on a canvas, neither of which jsdom
// supports. Render each node as a button wired to the same handlers instead,
// so the test can see which tables are on screen and focus one of them.
vi.mock('@xyflow/react', () => ({
    ReactFlowProvider: ({children}: {children: ReactNode}) => <>{children}</>,
    ReactFlow: ({
        nodes,
        onNodeContextMenu,
        children,
    }: {
        nodes: Node[];
        onNodeContextMenu: (event: React.MouseEvent, node: Node) => void;
        children?: ReactNode;
    }) => (
        <div>
            {nodes.map((node) => (
                <button
                    key={node.id}
                    type="button"
                    data-testid={`node-${node.id}`}
                    onContextMenu={(event) => onNodeContextMenu(event, node)}
                >
                    {node.id}
                </button>
            ))}
            {children}
        </div>
    ),
    Background: () => null,
    Controls: ({children}: {children?: ReactNode}) => <div>{children}</div>,
    ControlButton: ({children}: {children?: ReactNode}) => <div>{children}</div>,
    MiniMap: () => null,
    Handle: () => null,
    Position: {Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right'},
    useNodesState: (initial: Node[]) => {
        const [nodes, setNodes] = useState(initial);
        return [nodes, setNodes, () => {}];
    },
    useEdgesState: (initial: Edge[]) => {
        const [edges, setEdges] = useState(initial);
        return [edges, setEdges, () => {}];
    },
    useReactFlow: () => mocks.reactFlow,
}));

vi.mock('@xyflow/react/dist/style.css', () => ({}));

// The shared setup mock only covers a subset of icons; the diagram toolbar and
// menus need the real ones.
vi.mock('lucide-react', async (importOriginal) => await importOriginal());

vi.mock('react-i18next', () => {
    const t = (key: string) => key;
    return {useTranslation: () => ({t})};
});

vi.mock('react-router-dom', () => ({
    useSearchParams: () => [mocks.searchParams],
}));

vi.mock('@/hooks/useEditor', () => ({
    useEditor: () => ({getSchema: mocks.getSchema}),
}));

vi.mock('@/hooks/useAlert', () => ({
    useAlert: () => ({showAlert: mocks.showAlert}),
}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => mocks.settings,
}));

vi.mock('@/hooks/useTheme', () => ({
    useTheme: () => ({
        currentTheme: {
            colors: {
                border: {default: '#000000'},
                accent: {primary: '#000000'},
                bg: {base: '#ffffff'},
            },
        },
    }),
}));

vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => mocks.platform,
}));

vi.mock('@/utils/fileDownloads', () => ({
    downloadTextFile: mocks.downloadTextFile,
}));

import {SchemaDiagram} from '@/components/ui/SchemaDiagram';

const column = (name: string, data_type: string, is_pk = false) => ({
    name,
    data_type,
    is_pk,
    is_nullable: !is_pk,
    is_auto_increment: false,
});

const SCHEMA: TableSchema[] = [
    {
        name: 'users',
        columns: [column('id', 'int', true), column('email', 'varchar')],
        foreign_keys: [],
    },
    {
        name: 'orders',
        columns: [column('id', 'int', true), column('user_id', 'int')],
        foreign_keys: [
            {name: 'fk_orders_user', column_name: 'user_id', ref_table: 'users', ref_column: 'id'},
        ],
    },
    {
        name: 'audit_log',
        columns: [column('id', 'int', true)],
        foreign_keys: [],
    },
];

describe('SchemaDiagram Markdown export', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSchema.mockResolvedValue(SCHEMA);
        mocks.downloadTextFile.mockResolvedValue(true);
    });

    it('exports every loaded table even while one table is focused', async () => {
        render(<SchemaDiagram connectionId="conn-1" refreshTrigger={0} schema="public" />);

        await screen.findByTestId('node-audit_log');

        // Focusing users hides audit_log, which has no relationship to it.
        fireEvent.contextMenu(screen.getByTestId('node-users'));
        fireEvent.click(screen.getByText('erDiagram.focusOnTable'));
        await waitFor(() => expect(screen.queryByTestId('node-audit_log')).toBeNull());

        fireEvent.click(screen.getByRole('button', {name: /erDiagram\.export$/}));
        fireEvent.click(screen.getByText('erDiagram.exportMarkdown'));

        await waitFor(() => expect(mocks.downloadTextFile).toHaveBeenCalledTimes(1));
        const [, request] = mocks.downloadTextFile.mock.calls[0];

        expect(request.fileName).toMatch(/^schema_\d{4}-\d{2}-\d{2}\.md$/);
        expect(request.mimeType).toBe('text/markdown');
        expect(request.filters).toEqual([{name: 'Markdown', extensions: ['md']}]);

        const headings = (request.contents as string)
            .split('\n')
            .filter((line) => line.startsWith('### '));
        expect(headings).toEqual(['### audit_log', '### orders', '### users']);
        expect(request.contents).toContain('Scope: public');
        expect(request.contents).toContain('Covers the 3 tables loaded in the ER diagram.');
        expect(request.contents).toContain('| orders | user_id | users | id |');

        await waitFor(() =>
            expect(mocks.showAlert).toHaveBeenCalledWith('erDiagram.exportSuccess', {
                kind: 'info',
            }),
        );
    });

    it('does not report success when the save dialog is cancelled', async () => {
        mocks.downloadTextFile.mockResolvedValue(false);
        render(<SchemaDiagram connectionId="conn-1" refreshTrigger={0} />);

        await screen.findByTestId('node-users');
        fireEvent.click(screen.getByRole('button', {name: /erDiagram\.export$/}));
        fireEvent.click(screen.getByText('erDiagram.exportMarkdown'));

        await waitFor(() => expect(mocks.downloadTextFile).toHaveBeenCalledTimes(1));
        expect(mocks.downloadTextFile.mock.calls[0][1].contents).not.toContain('Scope:');
        expect(mocks.showAlert).not.toHaveBeenCalled();
    });
});
