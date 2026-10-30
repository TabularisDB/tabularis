import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import type React from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {SidebarDatabaseItem} from '@/components/layout/sidebar/SidebarDatabaseItem';
import type {DriverCapabilities} from '@/types/plugins';
import {UI_STATE_KEYS, uiStateStore} from '@/utils/uiStateStore';
import {pinScope} from '@/utils/explorerPins';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key}),
}));

// Real icons: tables and the Pinned group render icons the global mock lacks.
vi.mock('lucide-react', async () => await vi.importActual('lucide-react'));

// Table items need a client; these tests never expand one, so it is never called.
vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => ({call: vi.fn(() => Promise.resolve([]))}),
}));

describe('SidebarDatabaseItem', () => {
    it('starts one lazy load when an unloaded database is expanded', async () => {
        const onLoadDatabase = vi.fn();

        render(
            <SidebarDatabaseItem
                databaseName="issue637"
                databaseData={undefined}
                activeTable={null}
                activeSchema={null}
                connectionId="conn-637"
                driver="mysql"
                schemaVersion={1}
                onLoadDatabase={onLoadDatabase}
                onRefreshDatabase={vi.fn()}
                onTableClick={vi.fn()}
                onTableDoubleClick={vi.fn()}
                onViewClick={vi.fn()}
                onViewDoubleClick={vi.fn()}
                onRoutineDoubleClick={vi.fn()}
                onTriggerDoubleClick={vi.fn()}
                onContextMenu={vi.fn()}
                onAddColumn={vi.fn()}
                onEditColumn={vi.fn()}
                onAddIndex={vi.fn()}
                onDropIndex={vi.fn()}
                onAddForeignKey={vi.fn()}
                onDropForeignKey={vi.fn()}
                onCreateTable={vi.fn()}
                onCreateView={vi.fn()}
                onCreateTrigger={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByText('issue637'));

        await waitFor(() => {
            expect(onLoadDatabase).toHaveBeenCalledTimes(1);
        });
        expect(onLoadDatabase).toHaveBeenCalledWith('issue637');
    });
});

describe('SidebarDatabaseItem — New routine button', () => {
    const renderDatabase = (onCreateRoutine?: (e: React.MouseEvent, database: string) => void) =>
        render(
            <SidebarDatabaseItem
                databaseName="shop"
                databaseData={{
                    tables: [],
                    views: [],
                    routines: [],
                    triggers: [],
                    isLoaded: true,
                    isLoading: false,
                }}
                activeTable={null}
                // Matching activeSchema auto-expands the database body.
                activeSchema="shop"
                connectionId="conn-1"
                driver="mysql"
                schemaVersion={1}
                capabilities={{routines: true} as DriverCapabilities}
                onLoadDatabase={vi.fn()}
                onRefreshDatabase={vi.fn()}
                onTableClick={vi.fn()}
                onTableDoubleClick={vi.fn()}
                onViewClick={vi.fn()}
                onViewDoubleClick={vi.fn()}
                onRoutineDoubleClick={vi.fn()}
                onTriggerDoubleClick={vi.fn()}
                onContextMenu={vi.fn()}
                onAddColumn={vi.fn()}
                onEditColumn={vi.fn()}
                onAddIndex={vi.fn()}
                onDropIndex={vi.fn()}
                onAddForeignKey={vi.fn()}
                onDropForeignKey={vi.fn()}
                onCreateTable={vi.fn()}
                onCreateView={vi.fn()}
                onCreateTrigger={vi.fn()}
                onCreateRoutine={onCreateRoutine}
            />,
        );

    it('opens the New routine menu for its own database', () => {
        const onCreateRoutine = vi.fn();
        renderDatabase(onCreateRoutine);

        fireEvent.click(screen.getByTitle('routines.newRoutine'));

        expect(onCreateRoutine).toHaveBeenCalledWith(expect.anything(), 'shop');
    });

    it('has no New routine button without routine management', () => {
        renderDatabase();

        expect(screen.queryByTitle('routines.newRoutine')).toBeNull();
    });
});

describe('SidebarDatabaseItem — pinned objects (#1306)', () => {
    beforeEach(() => {
        localStorage.clear();
        uiStateStore.reset();
    });

    it('lists the pinned tables and views of its own database', () => {
        uiStateStore.set(UI_STATE_KEYS.explorerPins.key, {
            'conn-1': {
                [pinScope(undefined, 'shop')]: [
                    {kind: 'view', name: 'daily_sales'},
                    {kind: 'table', name: 'orders'},
                ],
                [pinScope(undefined, 'crm')]: [{kind: 'table', name: 'customers'}],
            },
        });
        render(
            <SidebarDatabaseItem
                databaseName="shop"
                databaseData={{
                    tables: [{name: 'customers'}, {name: 'orders'}],
                    views: [{name: 'daily_sales'}],
                    routines: [],
                    triggers: [],
                    isLoaded: true,
                    isLoading: false,
                }}
                activeTable={null}
                // Matching activeSchema auto-expands the database body.
                activeSchema="shop"
                connectionId="conn-1"
                driver="mysql"
                schemaVersion={1}
                onLoadDatabase={vi.fn()}
                onRefreshDatabase={vi.fn()}
                onTableClick={vi.fn()}
                onTableDoubleClick={vi.fn()}
                onViewClick={vi.fn()}
                onViewDoubleClick={vi.fn()}
                onRoutineDoubleClick={vi.fn()}
                onTriggerDoubleClick={vi.fn()}
                onContextMenu={vi.fn()}
                onAddColumn={vi.fn()}
                onEditColumn={vi.fn()}
                onAddIndex={vi.fn()}
                onDropIndex={vi.fn()}
                onAddForeignKey={vi.fn()}
                onDropForeignKey={vi.fn()}
                onCreateTable={vi.fn()}
                onCreateView={vi.fn()}
                onCreateTrigger={vi.fn()}
            />,
        );

        const group = screen.getByRole('group', {name: 'sidebar.pinned'});
        expect(within(group).getByText('orders')).toBeInTheDocument();
        expect(within(group).getByText('daily_sales')).toBeInTheDocument();
        expect(within(group).queryByText('customers')).toBeNull();
    });
});
