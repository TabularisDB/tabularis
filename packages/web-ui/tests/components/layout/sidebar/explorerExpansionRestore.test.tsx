import {fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {SidebarSchemaItem} from '@/components/layout/sidebar/SidebarSchemaItem';
import {SidebarNestedDatabaseItem} from '@/components/layout/sidebar/SidebarNestedDatabaseItem';
import type {NestedDatabaseData, SchemaData} from '@/contexts/DatabaseContext';
import {expansionKey} from '@/utils/explorerExpansion';
import {UI_STATE_KEYS, uiStateStore} from '@/utils/uiStateStore';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key}),
}));

// The sidebar items render icons the global lucide-react mock lacks.
vi.mock('lucide-react', async () => await vi.importActual('lucide-react'));

const STORE_KEY = UI_STATE_KEYS.explorerExpanded.key;

function saveExpanded(keys: string[]) {
    uiStateStore.set(STORE_KEY, Object.fromEntries(keys.map((key) => [key, true])));
}

/** The item's own header row is the first element that reports its expanded state. */
function headerExpanded(container: HTMLElement): string | null {
    return container.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') ?? null;
}

const unloadedSchema: SchemaData = {
    tables: [],
    views: [],
    materializedViews: [],
    routines: [],
    triggers: [],
    isLoaded: false,
    isLoading: false,
};

const schemaProps = {
    schemaName: 'public',
    database: 'shop',
    activeTable: null,
    activeSchema: null,
    connectionId: 'conn-1',
    driver: 'postgres',
    schemaVersion: 1,
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

const schemaKey = expansionKey('conn-1', ['schema', 'shop', 'public']);

describe('SidebarSchemaItem expansion restore', () => {
    let onLoadSchema: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        onLoadSchema = vi.fn();
    });

    it('restores a saved expanded schema and loads it once', () => {
        saveExpanded([schemaKey]);

        const {container, rerender} = render(
            <SidebarSchemaItem
                {...schemaProps}
                schemaData={unloadedSchema}
                onLoadSchema={onLoadSchema}
            />,
        );

        expect(headerExpanded(container)).toBe('true');
        expect(onLoadSchema).toHaveBeenCalledTimes(1);
        expect(onLoadSchema).toHaveBeenCalledWith('public');

        // A load that ends without data must not be retried in a loop.
        rerender(
            <SidebarSchemaItem
                {...schemaProps}
                schemaData={{...unloadedSchema, isLoading: true}}
                onLoadSchema={onLoadSchema}
            />,
        );
        rerender(
            <SidebarSchemaItem
                {...schemaProps}
                schemaData={unloadedSchema}
                onLoadSchema={onLoadSchema}
            />,
        );
        expect(onLoadSchema).toHaveBeenCalledTimes(1);
    });

    it('does not load a restored schema that is already loaded', () => {
        saveExpanded([schemaKey]);

        render(
            <SidebarSchemaItem
                {...schemaProps}
                schemaData={{...unloadedSchema, isLoaded: true}}
                onLoadSchema={onLoadSchema}
            />,
        );

        expect(onLoadSchema).not.toHaveBeenCalled();
    });

    it('stays collapsed and does not load without a saved state', () => {
        const {container} = render(
            <SidebarSchemaItem
                {...schemaProps}
                schemaData={unloadedSchema}
                onLoadSchema={onLoadSchema}
            />,
        );

        expect(headerExpanded(container)).toBe('false');
        expect(onLoadSchema).not.toHaveBeenCalled();
    });

    it('ignores the saved state of another connection or database', () => {
        saveExpanded([
            expansionKey('conn-2', ['schema', 'shop', 'public']),
            expansionKey('conn-1', ['schema', 'crm', 'public']),
        ]);

        const {container} = render(
            <SidebarSchemaItem
                {...schemaProps}
                schemaData={unloadedSchema}
                onLoadSchema={onLoadSchema}
            />,
        );

        expect(headerExpanded(container)).toBe('false');
        expect(onLoadSchema).not.toHaveBeenCalled();
    });

    it('loads once when the user expands it and saves the state', () => {
        const {container} = render(
            <SidebarSchemaItem
                {...schemaProps}
                schemaData={unloadedSchema}
                onLoadSchema={onLoadSchema}
            />,
        );

        fireEvent.click(screen.getByText('public'));

        expect(headerExpanded(container)).toBe('true');
        expect(onLoadSchema).toHaveBeenCalledTimes(1);
        expect(uiStateStore.get(STORE_KEY, null)).toEqual({[schemaKey]: true});
    });

    it('opens the active schema without saving it', () => {
        const {container} = render(
            <SidebarSchemaItem
                {...schemaProps}
                activeSchema="public"
                schemaData={{...unloadedSchema, isLoaded: true}}
                onLoadSchema={onLoadSchema}
            />,
        );

        expect(headerExpanded(container)).toBe('true');
        expect(uiStateStore.get(STORE_KEY, null)).toBeNull();
    });
});

const nestedProps = {
    databaseName: 'shop',
    activeTable: null,
    connectionId: 'conn-1',
    driver: 'postgresql',
    schemaVersion: 1,
    onLoadSchemaData: vi.fn(),
    onRefreshSchemaData: vi.fn(),
    onSetSelectedSchemas: vi.fn(),
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
    onNewConsole: vi.fn(),
};

const unloadedNested: NestedDatabaseData = {
    schemas: [],
    schemasLoaded: false,
    isLoadingSchemas: false,
    selectedSchemas: [],
    activeSchema: null,
    needsSchemaSelection: false,
    schemaDataMap: {},
};

const databaseKey = expansionKey('conn-1', ['db', 'shop']);

describe('SidebarNestedDatabaseItem expansion restore', () => {
    let onLoadSchemas: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        onLoadSchemas = vi.fn();
    });

    it('restores a saved expanded database and loads its schemas once', () => {
        saveExpanded([databaseKey]);

        const {container, rerender} = render(
            <SidebarNestedDatabaseItem
                {...nestedProps}
                nestedData={unloadedNested}
                onLoadSchemas={onLoadSchemas}
            />,
        );

        expect(headerExpanded(container)).toBe('true');
        expect(onLoadSchemas).toHaveBeenCalledTimes(1);
        expect(onLoadSchemas).toHaveBeenCalledWith('shop');

        rerender(
            <SidebarNestedDatabaseItem
                {...nestedProps}
                nestedData={{...unloadedNested, isLoadingSchemas: true}}
                onLoadSchemas={onLoadSchemas}
            />,
        );
        rerender(
            <SidebarNestedDatabaseItem
                {...nestedProps}
                nestedData={unloadedNested}
                onLoadSchemas={onLoadSchemas}
            />,
        );
        expect(onLoadSchemas).toHaveBeenCalledTimes(1);
    });

    it('stays collapsed and does not load without a saved state', () => {
        const {container} = render(
            <SidebarNestedDatabaseItem
                {...nestedProps}
                nestedData={unloadedNested}
                onLoadSchemas={onLoadSchemas}
            />,
        );

        expect(headerExpanded(container)).toBe('false');
        expect(onLoadSchemas).not.toHaveBeenCalled();
    });

    it('ignores the saved state of another connection', () => {
        saveExpanded([expansionKey('conn-2', ['db', 'shop'])]);

        const {container} = render(
            <SidebarNestedDatabaseItem
                {...nestedProps}
                nestedData={unloadedNested}
                onLoadSchemas={onLoadSchemas}
            />,
        );

        expect(headerExpanded(container)).toBe('false');
        expect(onLoadSchemas).not.toHaveBeenCalled();
    });

    it('loads once when the user expands it and saves the state', () => {
        render(
            <SidebarNestedDatabaseItem
                {...nestedProps}
                nestedData={unloadedNested}
                onLoadSchemas={onLoadSchemas}
            />,
        );

        fireEvent.click(screen.getByText('shop'));

        expect(onLoadSchemas).toHaveBeenCalledTimes(1);
        expect(uiStateStore.get(STORE_KEY, null)).toEqual({[databaseKey]: true});
    });
});
