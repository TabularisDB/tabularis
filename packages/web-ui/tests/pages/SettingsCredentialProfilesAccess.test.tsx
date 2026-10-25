import {StrictMode} from 'react';
import {render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Settings} from '@/pages/Settings';
import type {SessionNegotiation} from '@/api/session';

const mockUseCanManageCredentialProfiles = vi.fn(() => true);

vi.mock('lucide-react', async () => await vi.importActual('lucide-react'));

vi.mock('@/hooks/useCanManageCredentialProfiles', () => ({
    useCanManageCredentialProfiles: () => mockUseCanManageCredentialProfiles(),
}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: {}, isLoading: false, updateSetting: vi.fn()}),
}));

vi.mock('@/hooks/useAvailableUpdates', () => ({
    useAvailableUpdates: () => ({
        coreCount: 0,
        pluginCount: 0,
        totalCount: 0,
        summary: '',
        coreTooltip: '',
        pluginsTooltip: '',
        pluginDetails: [],
    }),
}));

vi.mock('@/hooks/useDrivers', () => ({
    useDrivers: () => ({
        allDrivers: [],
        installedPlugins: [],
        refresh: vi.fn(),
    }),
}));

vi.mock('@/components/modals/ConfigJsonModal', () => ({
    ConfigJsonModal: () => null,
}));

vi.mock('@/components/settings/GeneralTab', () => ({
    GeneralTab: () => <div>GeneralTab</div>,
}));
vi.mock('@/components/settings/CredentialProfilesTab', () => ({
    CredentialProfilesTab: () => <div>CredentialProfilesTab</div>,
}));
vi.mock('@/components/settings/NetworkTab', () => ({
    NetworkTab: () => <div>NetworkTab</div>,
}));
vi.mock('@/components/settings/BackupTab', () => ({
    BackupTab: () => <div>BackupTab</div>,
}));
vi.mock('@/components/settings/StorageTab', () => ({
    StorageTab: () => <div>StorageTab</div>,
}));
vi.mock('@/components/settings/PrivacyTab', () => ({
    PrivacyTab: () => <div>PrivacyTab</div>,
}));
vi.mock('@/components/settings/AppearanceTab', () => ({
    AppearanceTab: () => <div>AppearanceTab</div>,
}));
vi.mock('@/components/settings/LocalizationTab', () => ({
    LocalizationTab: () => <div>LocalizationTab</div>,
}));
vi.mock('@/components/settings/AiTab', () => ({
    AiTab: () => <div>AiTab</div>,
}));
vi.mock('@/components/settings/LogsTab', () => ({
    LogsTab: () => <div>LogsTab</div>,
}));
vi.mock('@/components/settings/ShortcutsTab', () => ({
    ShortcutsTab: () => <div>ShortcutsTab</div>,
}));
vi.mock('@/components/settings/SshTab', () => ({
    SshTab: () => <div>SshTab</div>,
}));
vi.mock('@/components/settings/PluginsTab', () => ({
    PluginsTab: () => <div>PluginsTab</div>,
}));
vi.mock('@/components/settings/AiActivityPanel', () => ({
    AiActivityPanel: () => <div>AiActivityPanel</div>,
}));
vi.mock('@/components/settings/InfoTab', () => ({
    InfoTab: () => <div>InfoTab</div>,
}));
vi.mock('@/components/settings/PluginSettingsPage', () => ({
    PluginSettingsPage: () => <div>PluginSettingsPage</div>,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) =>
            ({
                'settings.general': 'General',
                'settings.network.tab': 'Network',
                'sshConnections.title': 'SSH',
                'credentialProfiles.title': 'Credential profiles',
                'settings.storage.title': 'Storage',
                'settings.backup.title': 'Backup',
                'settings.plugins.title': 'Plugins',
                'settings.appearance': 'Appearance',
                'settings.privacy': 'Privacy',
                'settings.localization': 'Localization',
                'settings.ai.tab': 'AI',
                'settings.aiActivity': 'AI activity',
                'settings.logs': 'Logs',
                'settings.shortcuts.title': 'Shortcuts',
                'settings.info': 'Info',
                'settings.editConfigJson': 'Edit config JSON',
            })[key] ?? key,
    }),
}));

function renderSettings(path = '/settings') {
    return render(
        <StrictMode>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path="/settings" element={<Settings />} />
                </Routes>
            </MemoryRouter>
        </StrictMode>,
    );
}

describe('Settings credential profile access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseCanManageCredentialProfiles.mockReturnValue(true);
    });

    it('shows the credential profiles tab for local-admin sessions', () => {
        renderSettings();
        expect(screen.getByRole('button', {name: 'Credential profiles'})).toBeInTheDocument();
    });

    it('hides the credential profiles tab for database-only web sessions', () => {
        mockUseCanManageCredentialProfiles.mockReturnValue(false);
        renderSettings();
        expect(screen.queryByRole('button', {name: 'Credential profiles'})).not.toBeInTheDocument();
    });

    it('falls back to general when a direct tab URL targets credential profiles without access', () => {
        mockUseCanManageCredentialProfiles.mockReturnValue(false);
        renderSettings('/settings?tab=credential-profiles');
        expect(screen.getByText('GeneralTab')).toBeInTheDocument();
        expect(screen.queryByText('CredentialProfilesTab')).not.toBeInTheDocument();
    });
});

export const DATABASE_WEB_SESSION: SessionNegotiation = {
    apiVersion: 'v1',
    serverVersion: '1.0.0',
    serverBuild: {target: 'linux-x86_64', profile: 'release', commit: null},
    authenticated: true,
    csrfToken: 'csrf',
    access: {
        remote: true,
        authorizationLevel: 'database',
        highRiskCapabilities: false,
    },
    capabilities: {
        rpc: true,
        events: true,
        uploads: true,
        downloads: true,
        pluginAssets: true,
        mcpHostConfiguration: false,
        serverFileBrowser: false,
        nativeUpdater: false,
    },
    queryResponsePolicy: {
        maxRowsPerPage: 10_000,
        maxResponseBytes: 16_777_216,
        streaming: false,
    },
};
