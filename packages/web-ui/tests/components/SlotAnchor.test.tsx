import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import {PluginSlotProvider} from '@/contexts/PluginSlotProvider';
import {PluginSlotContext} from '@/contexts/PluginSlotContext';
import {SettingsContext, DEFAULT_SETTINGS} from '@/contexts/SettingsContext';
import {SlotAnchor} from '@/components/ui/SlotAnchor';
import type {SlotComponentProps} from '@/types/pluginSlots';

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => ({call: vi.fn()}),
}));
vi.mock('@/hooks/useDrivers', () => ({useDrivers: () => ({installedPlugins: []})}));

const settingsValue = {
    settings: DEFAULT_SETTINGS,
    updateSetting: () => {},
    isLoading: false,
};

const GoodPlugin = ({pluginId}: SlotComponentProps) => (
    <span data-testid="good-plugin">{pluginId}</span>
);

const CrashingPlugin = () => {
    throw new Error('Plugin crash!');
};

describe('SlotAnchor', () => {
    it('should render nothing when no contributions exist', () => {
        const {container} = render(
            <SettingsContext.Provider value={settingsValue}>
                <PluginSlotProvider>
                    <SlotAnchor
                        name="sidebar.footer.actions"
                        context={{connectionId: null, driver: null}}
                    />
                </PluginSlotProvider>
            </SettingsContext.Provider>,
        );

        expect(container.innerHTML).toBe('');
    });

    it('should render nothing when outside provider', () => {
        const {container} = render(
            <SlotAnchor
                name="sidebar.footer.actions"
                context={{connectionId: null, driver: null}}
            />,
        );

        expect(container.innerHTML).toBe('');
    });

    it('should render contributions for the matching slot', () => {
        const mockRegistry = {
            contributions: [],
            register: () => () => {},
            registerAll: () => () => {},
            getSlotContributions: (slot: string) => {
                if (slot === 'sidebar.footer.actions') {
                    return [
                        {
                            pluginId: 'test-plugin',
                            slot: 'sidebar.footer.actions' as const,
                            component: GoodPlugin,
                        },
                    ];
                }
                return [];
            },
        };

        render(
            <PluginSlotContext.Provider value={mockRegistry}>
                <SlotAnchor
                    name="sidebar.footer.actions"
                    context={{connectionId: null, driver: null}}
                />
            </PluginSlotContext.Provider>,
        );

        expect(screen.getByTestId('good-plugin')).toHaveTextContent('test-plugin');
    });

    it('should isolate plugin crashes with ErrorBoundary', () => {
        const mockRegistry = {
            contributions: [],
            register: () => () => {},
            registerAll: () => () => {},
            getSlotContributions: () => [
                {
                    pluginId: 'crashing-plugin',
                    slot: 'sidebar.footer.actions' as const,
                    component: CrashingPlugin,
                },
                {
                    pluginId: 'good-plugin',
                    slot: 'sidebar.footer.actions' as const,
                    component: GoodPlugin,
                },
            ],
        };

        render(
            <PluginSlotContext.Provider value={mockRegistry}>
                <SlotAnchor
                    name="sidebar.footer.actions"
                    context={{connectionId: null, driver: null}}
                />
            </PluginSlotContext.Provider>,
        );

        // The crashing plugin should show an error message
        expect(screen.getByText('Plugin error: crashing-plugin')).toBeInTheDocument();
        // The good plugin should still render
        expect(screen.getByTestId('good-plugin')).toBeInTheDocument();
    });

    it('should set data-slot attribute on wrapper', () => {
        const mockRegistry = {
            contributions: [],
            register: () => () => {},
            registerAll: () => () => {},
            getSlotContributions: () => [
                {pluginId: 'p1', slot: 'data-grid.toolbar.actions' as const, component: GoodPlugin},
            ],
        };

        render(
            <PluginSlotContext.Provider value={mockRegistry}>
                <SlotAnchor
                    name="data-grid.toolbar.actions"
                    context={{connectionId: null, tableName: null, schema: null, driver: null}}
                    className="test-class"
                />
            </PluginSlotContext.Provider>,
        );

        const wrapper = screen.getByTestId('good-plugin').parentElement;
        expect(wrapper?.getAttribute('data-slot')).toBe('data-grid.toolbar.actions');
        expect(wrapper?.className).toContain('test-class');
    });
    it('filters workspace content by owner and shows a fallback if unavailable', () => {
        const registry = {
            contributions: [],
            register: () => () => {},
            registerAll: () => () => {},
            getSlotContributions: () => [
                {
                    pluginId: 'owner',
                    slot: 'editor.workspace.content' as const,
                    component: GoodPlugin,
                },
                {
                    pluginId: 'other',
                    slot: 'editor.workspace.content' as const,
                    component: GoodPlugin,
                },
            ],
        };
        const context = {
            pluginId: 'owner',
            workspaceId: 'services',
            connectionId: 'c1',
            driver: 'custom',
            schema: null,
        };
        const {rerender} = render(
            <PluginSlotContext.Provider value={registry}>
                <SlotAnchor
                    name="editor.workspace.content"
                    pluginId="owner"
                    context={context}
                    fallback={<p>Unavailable</p>}
                />
            </PluginSlotContext.Provider>,
        );
        expect(screen.getAllByTestId('good-plugin')).toHaveLength(1);
        expect(screen.getByTestId('good-plugin')).toHaveTextContent('owner');
        rerender(
            <PluginSlotContext.Provider value={registry}>
                <SlotAnchor
                    name="editor.workspace.content"
                    pluginId="missing"
                    context={context}
                    fallback={<p>Unavailable</p>}
                />
            </PluginSlotContext.Provider>,
        );
        expect(screen.getByText('Unavailable')).toBeInTheDocument();
        expect(screen.queryByTestId('good-plugin')).not.toBeInTheDocument();
    });
});
