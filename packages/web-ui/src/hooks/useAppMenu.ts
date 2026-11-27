import {useEffect, useMemo, useRef} from 'react';
import {useNavigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {useCommandPaletteDispatch} from './useCommandPalette';
import {useKeybindings} from './useKeybindings';
import {usePlatformCapabilities} from './usePlatformCapabilities';
import {useUpdate} from './useUpdate';
import {
    APP_MENU_LINKS,
    APP_MENU_SECTIONS,
    APP_MENU_SETTINGS_INFO_PATH,
    shouldInstallAppMenu,
    type AppMenuActionId,
} from '@/utils/appMenu';

type AppMenuHandlers = Record<AppMenuActionId, () => void>;

/**
 * Adds Tabularis actions to the native macOS menu bar, so they are reachable
 * from the menu and from tools that search menu items.
 * Must be called inside BrowserRouter, KeybindingsProvider and CommandPaletteProvider.
 */
export function useAppMenu() {
    const platform = usePlatformCapabilities();
    const {t} = useTranslation();
    const navigate = useNavigate();
    const {openPalette} = useCommandPaletteDispatch();
    const {isMac} = useKeybindings();
    const {checkForUpdates, installationSource, updaterMode} = useUpdate();

    const enabled = shouldInstallAppMenu({
        environment: platform.negotiation.environment,
        windowLabel: platform.currentWindowLabel(),
        isMac,
    });

    const handlers = useMemo<AppMenuHandlers>(
        () => ({
            check_for_updates: () => {
                // The Info tab shows the result of the check.
                navigate(APP_MENU_SETTINGS_INFO_PATH);
                if (updaterMode === 'native' && !installationSource) void checkForUpdates(true);
            },
            open_settings: () => navigate('/settings'),
            new_connection: () => navigate('/connections', {state: {openNew: true}}),
            open_connections: () => navigate('/connections'),
            command_palette: () => openPalette('all'),
            quick_navigator: () => openPalette('objects'),
            command_palette_actions: () => openPalette('actions'),
            toggle_sidebar: () => window.dispatchEvent(new CustomEvent('tabularis:toggle-sidebar')),
            toggle_right_sidebar: () =>
                window.dispatchEvent(new CustomEvent('tabularis:toggle-right-sidebar')),
            open_website: () => void platform.openExternalUrl(APP_MENU_LINKS.open_website),
            report_issue: () => void platform.openExternalUrl(APP_MENU_LINKS.report_issue),
            open_discord: () => void platform.openExternalUrl(APP_MENU_LINKS.open_discord),
        }),
        [checkForUpdates, installationSource, navigate, openPalette, platform, updaterMode],
    );

    // Native menu items keep the callback they were built with; the ref lets them
    // reach the latest handlers without rebuilding the menu on every render.
    const handlersRef = useRef(handlers);
    useEffect(() => {
        handlersRef.current = handlers;
    }, [handlers]);

    useEffect(() => {
        if (!enabled || !platform.setAppMenu) return;
        const sections = APP_MENU_SECTIONS.map((section) => ({
            ...section,
            entries: section.entries.map((entry) =>
                entry === 'separator'
                    ? entry
                    : {
                          id: `tabularis:${entry.id}`,
                          label: t(entry.labelKey),
                          run: () => handlersRef.current[entry.id](),
                      },
            ),
        }));
        platform.setAppMenu(sections).catch((err: unknown) => {
            console.error('Failed to install the app menu:', err);
        });
    }, [enabled, platform, t]);
}
