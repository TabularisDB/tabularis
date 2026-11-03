import {render, screen, fireEvent, within} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import React from 'react';
import {SidebarSchemaItem} from '@/components/layout/sidebar/SidebarSchemaItem';
import {UI_STATE_KEYS, uiStateStore} from '@/utils/uiStateStore';
import {pinScope, type PinnedObject} from '@/utils/explorerPins';
import {invoke} from '@tauri-apps/api/core';

const clientMock = vi.hoisted(() => ({call: vi.fn()}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => clientMock,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key}),
}));

// Real icons: tables and the Pinned group render icons the global mock lacks.
vi.mock('lucide-react', async () => await vi.importActual('lucide-react'));

const baseSchemaData = {
    tables: [],
    views: [],
    materializedViews: [],
    routines: [],
    triggers: [],
    isLoaded: true,
    isLoading: false,
};

const defaultProps = {
    schemaName: 'public',
    activeTable: null,
    // Matching activeSchema auto-expands the schema body on first render.
    activeSchema: 'public',
    connectionId: 'conn-123',
    driver: 'postgres',
    schemaVersion: 1,
    onLoadSchema: vi.fn(),
    onRefreshSchema: vi.fn(),
    onTableClick: vi.fn(),
    onTableDoubleClick: vi.fn(),
    onViewClick: vi.fn(),
    onViewDoubleClick: vi.fn(),
    onRoutineDoubleClick: vi.fn(),
    onTriggerDoubleClick: vi.fn(),
    onContextMenu: vi.fn(),
    onAddColumn: vi.fn(),
    onEditColumn: vi.fn(),
    onAddIndex: vi.fn(),
    onDropIndex: vi.fn(),
    onAddForeignKey: vi.fn(),
    onDropForeignKey: vi.fn(),
    onCreateTable: vi.fn(),
    onCreateView: vi.fn(),
    onCreateTrigger: vi.fn(),
};

describe('SidebarSchemaItem — materialized view double-click', () => {
    const baseSchemaData = {
        tables: [],
        views: [],
        materializedViews: [],
        routines: [],
        triggers: [],
        isLoaded: true,
        isLoading: false,
    };

    const defaultProps = {
        schemaName: 'public',
        activeTable: null,
        // Matching activeSchema auto-expands the schema body on first render.
        activeSchema: 'public',
        connectionId: 'conn-123',
        driver: 'postgres',
        schemaVersion: 1,
        onLoadSchema: vi.fn(),
        onRefreshSchema: vi.fn(),
        onNewConsole: vi.fn(),
        onTableClick: vi.fn(),
        onTableDoubleClick: vi.fn(),
        onViewClick: vi.fn(),
        onViewDoubleClick: vi.fn(),
        onRoutineDoubleClick: vi.fn(),
        onTriggerDoubleClick: vi.fn(),
        onContextMenu: vi.fn(),
        onAddColumn: vi.fn(),
        onEditColumn: vi.fn(),
        onAddIndex: vi.fn(),
        onDropIndex: vi.fn(),
        onAddForeignKey: vi.fn(),
        onDropForeignKey: vi.fn(),
        onCreateTable: vi.fn(),
        onCreateView: vi.fn(),
        onCreateTrigger: vi.fn(),
    };

    beforeEach(() => {
        vi.mocked(invoke).mockClear();
        clientMock.call.mockReset();
        clientMock.call.mockImplementation((command: string, request: unknown) =>
            invoke(command, request),
        );
    });

    it('flags a materialized view (materialized=true) on double-click', () => {
        const onViewDoubleClick = vi.fn();
        render(
            <SidebarSchemaItem
                {...defaultProps}
                onViewDoubleClick={onViewDoubleClick}
                schemaData={{
                    ...baseSchemaData,
                    materializedViews: [{name: 'mv_sales'}],
                }}
            />,
        );

        // The materialized-views group is collapsed by default — open it first.
        fireEvent.click(screen.getByText('sidebar.materializedViews (1)'));
        fireEvent.doubleClick(screen.getByText('mv_sales'));

        expect(onViewDoubleClick).toHaveBeenCalledWith('mv_sales', 'public', true);
    });

    it('does not flag a regular view as materialized on double-click', () => {
        const onViewDoubleClick = vi.fn();
        render(
            <SidebarSchemaItem
                {...defaultProps}
                onViewDoubleClick={onViewDoubleClick}
                schemaData={{...baseSchemaData, views: [{name: 'v_active'}]}}
            />,
        );

        // The views group is open by default.
        fireEvent.doubleClick(screen.getByText('v_active'));

        // Called with only (name, schema) — the materialized arg stays undefined.
        expect(onViewDoubleClick).toHaveBeenCalledWith('v_active', 'public');
        expect(onViewDoubleClick).not.toHaveBeenCalledWith('v_active', 'public', true);
    });

    it('opens a new console scoped to the schema, with no database, for a plain single-database connection', () => {
        const onNewConsole = vi.fn();
        render(
            <SidebarSchemaItem
                {...defaultProps}
                onNewConsole={onNewConsole}
                schemaData={baseSchemaData}
            />,
        );

        // activeSchema === schemaName ("public") auto-expands the schema body.
        fireEvent.click(screen.getByTitle('sidebar.newConsole'));

        expect(onNewConsole).toHaveBeenCalledWith('public', undefined);
    });
});

describe('SidebarSchemaItem — New routine button', () => {
    it('opens the New routine menu for its own schema', () => {
        const onCreateRoutine = vi.fn();
        render(
            <SidebarSchemaItem
                {...defaultProps}
                schemaData={baseSchemaData}
                onCreateRoutine={onCreateRoutine}
            />,
        );

        fireEvent.click(screen.getByTitle('routines.newRoutine'));

        expect(onCreateRoutine).toHaveBeenCalledWith(expect.anything(), 'public');
    });

    it('has no New routine button without routine management', () => {
        render(<SidebarSchemaItem {...defaultProps} schemaData={baseSchemaData} />);

        expect(screen.queryByTitle('routines.newRoutine')).toBeNull();
    });
});

describe('SidebarSchemaItem — pinned objects (#1306)', () => {
    const schemaData = {
        ...baseSchemaData,
        tables: [{name: 'customers'}, {name: 'orders'}],
        views: [{name: 'active_users'}],
    };
    const pin = (pins: PinnedObject[], schema = 'public') =>
        uiStateStore.set(UI_STATE_KEYS.explorerPins.key, {
            'conn-123': {[pinScope(undefined, schema)]: pins},
        });
    const pinnedGroup = () => screen.queryByRole('group', {name: 'sidebar.pinned'});

    beforeEach(() => {
        localStorage.clear();
        uiStateStore.reset();
    });

    it('lists existing pinned tables and views in a Pinned group, keeping the full lists', () => {
        pin([
            {kind: 'view', name: 'active_users'},
            {kind: 'table', name: 'dropped'},
            {kind: 'table', name: 'orders'},
        ]);
        render(<SidebarSchemaItem {...defaultProps} schemaData={schemaData} />);

        const group = pinnedGroup()!;
        expect(within(group).getByText('orders')).toBeInTheDocument();
        expect(within(group).getByText('active_users')).toBeInTheDocument();
        expect(within(group).queryByText('dropped')).toBeNull();
        expect(within(group).queryByText('customers')).toBeNull();
        // The regular lists still show every table and view.
        expect(screen.getAllByText('orders')).toHaveLength(2);
        expect(screen.getAllByText('customers')).toHaveLength(1);
    });

    it('shows no Pinned group without pins in this schema', () => {
        pin([{kind: 'table', name: 'orders'}], 'sales');
        render(<SidebarSchemaItem {...defaultProps} schemaData={schemaData} />);
        expect(pinnedGroup()).toBeNull();
    });

    it('applies the table filter to the pinned objects', () => {
        pin([
            {kind: 'table', name: 'orders'},
            {kind: 'table', name: 'customers'},
        ]);
        render(<SidebarSchemaItem {...defaultProps} schemaData={schemaData} />);
        fireEvent.change(screen.getByPlaceholderText('sidebar.filterTables'), {
            target: {value: 'cust'},
        });
        const group = pinnedGroup()!;
        expect(within(group).getByText('customers')).toBeInTheDocument();
        expect(within(group).queryByText('orders')).toBeNull();
    });

    it('opens a pinned table like its regular item', () => {
        pin([{kind: 'table', name: 'orders'}]);
        const onTableDoubleClick = vi.fn();
        render(
            <SidebarSchemaItem
                {...defaultProps}
                schemaData={schemaData}
                onTableDoubleClick={onTableDoubleClick}
            />,
        );
        fireEvent.doubleClick(within(pinnedGroup()!).getByText('orders'));
        expect(onTableDoubleClick).toHaveBeenCalledWith('orders', 'public');
    });
});
