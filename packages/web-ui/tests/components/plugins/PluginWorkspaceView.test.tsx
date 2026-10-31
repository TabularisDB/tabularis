import {describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import {useEffect} from 'react';
import {PluginWorkspaceView} from '@/components/plugins/PluginWorkspaceView';
import {PluginSlotContext} from '@/contexts/PluginSlotContext';
import {SettingsContext, DEFAULT_SETTINGS} from '@/contexts/SettingsContext';
import {createInitialTabState} from '@/utils/editor';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: () => 'This workspace is unavailable. Enable or reinstall its plugin in Settings.',
    }),
}));

const tab = createInitialTabState('connection-1', {
    type: 'plugin-workspace',
    pluginId: 'provider',
    workspaceId: 'services',
});
const settingsValue = {
    settings: {...DEFAULT_SETTINGS, activeExternalDrivers: ['provider']},
    updateSetting: vi.fn(),
    isLoading: false,
};

describe('PluginWorkspaceView', () => {
    it('shows a clear unavailable state for missing plugin contributions', () => {
        render(
            <SettingsContext.Provider value={settingsValue}>
                <PluginWorkspaceView tab={tab} driver="custom" schema={null} />
            </SettingsContext.Provider>,
        );
        expect(screen.getByRole('status')).toHaveTextContent('workspace is unavailable');
    });

    it('unmounts plugin content immediately when disabled, even before registry reload', () => {
        const cleanup = vi.fn();
        const Content = () => {
            useEffect(() => cleanup, []);
            return <div>Provider services</div>;
        };
        const registry = {
            contributions: [],
            register: () => () => {},
            registerAll: () => () => {},
            getSlotContributions: () => [
                {
                    pluginId: 'provider',
                    slot: 'editor.workspace.content' as const,
                    component: Content,
                },
            ],
        };
        const view = (enabled: boolean) => (
            <SettingsContext.Provider
                value={{
                    ...settingsValue,
                    settings: {
                        ...DEFAULT_SETTINGS,
                        activeExternalDrivers: enabled ? ['provider'] : [],
                    },
                }}
            >
                <PluginSlotContext.Provider value={registry}>
                    <PluginWorkspaceView tab={tab} driver="custom" schema={null} />
                </PluginSlotContext.Provider>
            </SettingsContext.Provider>
        );
        const {rerender} = render(view(true));
        expect(screen.getByText('Provider services')).toBeInTheDocument();
        rerender(view(false));
        expect(screen.getByRole('status')).toHaveTextContent('workspace is unavailable');
        expect(cleanup).toHaveBeenCalledOnce();
    });
});
