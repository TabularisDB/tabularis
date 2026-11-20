import {renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {useAppMenu} from '@/hooks/useAppMenu';
import type {AppMenuItemSpec, AppMenuSectionSpec} from '@/platform/capabilities';

const navigateMock = vi.fn();
const openPaletteMock = vi.fn();
const checkForUpdatesMock = vi.fn();
const openExternalUrlMock = vi.fn(async () => undefined);
const setAppMenuMock = vi.fn(async (_sections: readonly AppMenuSectionSpec[]) => undefined);
let environment = 'tauri';
let installationSource: string | null = null;

vi.mock('react-router-dom', () => ({useNavigate: () => navigateMock}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
vi.mock('@/hooks/useKeybindings', () => ({useKeybindings: () => ({isMac: true})}));
vi.mock('@/hooks/useCommandPalette', () => ({
    useCommandPaletteDispatch: () => ({openPalette: openPaletteMock}),
}));
vi.mock('@/hooks/useUpdate', () => ({
    useUpdate: () => ({
        checkForUpdates: checkForUpdatesMock,
        installationSource,
        updaterMode: 'native',
    }),
}));
const platform = {
    get negotiation() {
        return {environment};
    },
    currentWindowLabel: () => 'main',
    openExternalUrl: openExternalUrlMock,
    setAppMenu: setAppMenuMock,
};
vi.mock('@/hooks/usePlatformCapabilities', () => ({usePlatformCapabilities: () => platform}));

function installedItems(): AppMenuItemSpec[] {
    const sections = setAppMenuMock.mock.lastCall?.[0] ?? [];
    return sections.flatMap((section) =>
        section.entries.filter((entry): entry is AppMenuItemSpec => entry !== 'separator'),
    );
}

function clickItem(id: string) {
    const item = installedItems().find((entry) => entry.id === `tabularis:${id}`);
    if (!item) throw new Error(`No menu item ${id}`);
    item.run();
}

describe('useAppMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        environment = 'tauri';
        installationSource = null;
    });

    it('installs translated entries with the update check right after About', async () => {
        renderHook(() => useAppMenu());
        await waitFor(() => expect(setAppMenuMock).toHaveBeenCalledOnce());

        const [appSection] = setAppMenuMock.mock.lastCall?.[0] ?? [];
        expect(appSection).toMatchObject({submenu: null, position: 1});
        expect(appSection.entries[0]).toMatchObject({
            id: 'tabularis:check_for_updates',
            label: 'appMenu.checkForUpdates',
        });
    });

    it('opens the Info tab and runs a forced update check', async () => {
        renderHook(() => useAppMenu());
        await waitFor(() => expect(setAppMenuMock).toHaveBeenCalled());

        clickItem('check_for_updates');

        expect(navigateMock).toHaveBeenCalledWith('/settings?tab=info');
        expect(checkForUpdatesMock).toHaveBeenCalledWith(true);
    });

    it('only opens the Info tab when a package manager owns updates', async () => {
        installationSource = 'homebrew';
        renderHook(() => useAppMenu());
        await waitFor(() => expect(setAppMenuMock).toHaveBeenCalled());

        clickItem('check_for_updates');

        expect(navigateMock).toHaveBeenCalledWith('/settings?tab=info');
        expect(checkForUpdatesMock).not.toHaveBeenCalled();
    });

    it('routes file, view and help entries to their actions', async () => {
        renderHook(() => useAppMenu());
        await waitFor(() => expect(setAppMenuMock).toHaveBeenCalled());

        clickItem('new_connection');
        clickItem('command_palette');
        clickItem('report_issue');

        expect(navigateMock).toHaveBeenCalledWith('/connections', {state: {openNew: true}});
        expect(openPaletteMock).toHaveBeenCalledWith('all');
        expect(openExternalUrlMock).toHaveBeenCalledWith(
            'https://github.com/TabularisDB/tabularis/issues',
        );
    });

    it('leaves the menu alone outside the desktop app', () => {
        environment = 'browser';
        renderHook(() => useAppMenu());

        expect(setAppMenuMock).not.toHaveBeenCalled();
    });
});
