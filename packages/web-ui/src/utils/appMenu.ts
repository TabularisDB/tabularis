import {LINKS} from '@/config/links';
import type {AppMenuSectionSpec} from '@/platform/capabilities';

export type AppMenuActionId =
    | 'check_for_updates'
    | 'open_settings'
    | 'new_connection'
    | 'open_connections'
    | 'command_palette'
    | 'quick_navigator'
    | 'command_palette_actions'
    | 'toggle_sidebar'
    | 'toggle_right_sidebar'
    | 'open_website'
    | 'report_issue'
    | 'open_discord';

export interface AppMenuAction {
    readonly id: AppMenuActionId;
    readonly labelKey: string;
}

export type AppMenuEntry = AppMenuAction | 'separator';

export interface AppMenuSection extends Omit<AppMenuSectionSpec, 'entries'> {
    readonly entries: readonly AppMenuEntry[];
}

/**
 * Entries added to the default macOS menu. No entry has an accelerator:
 * a native accelerator consumes the key before the webview sees it, and the
 * app already handles these shortcuts in JavaScript.
 */
export const APP_MENU_SECTIONS: readonly AppMenuSection[] = [
    {
        submenu: null,
        // Directly after "About".
        position: 1,
        entries: [
            {id: 'check_for_updates', labelKey: 'appMenu.checkForUpdates'},
            'separator',
            {id: 'open_settings', labelKey: 'appMenu.settings'},
        ],
    },
    {
        submenu: 'File',
        position: 0,
        entries: [
            {id: 'new_connection', labelKey: 'appMenu.newConnection'},
            {id: 'open_connections', labelKey: 'appMenu.openConnections'},
            'separator',
        ],
    },
    {
        submenu: 'View',
        position: 0,
        entries: [
            {id: 'command_palette', labelKey: 'appMenu.commandPalette'},
            {id: 'quick_navigator', labelKey: 'appMenu.quickNavigator'},
            {id: 'command_palette_actions', labelKey: 'appMenu.searchActions'},
            'separator',
            {id: 'toggle_sidebar', labelKey: 'appMenu.toggleSidebar'},
            {id: 'toggle_right_sidebar', labelKey: 'appMenu.toggleRightSidebar'},
            'separator',
        ],
    },
    {
        submenu: 'Help',
        position: null,
        entries: [
            {id: 'open_website', labelKey: 'appMenu.website'},
            {id: 'report_issue', labelKey: 'appMenu.reportIssue'},
            {id: 'open_discord', labelKey: 'appMenu.discord'},
        ],
    },
];

export const APP_MENU_LINKS = {
    open_website: LINKS.WEBSITE,
    report_issue: LINKS.GITHUB_ISSUES,
    open_discord: LINKS.DISCORD,
} as const satisfies Partial<Record<AppMenuActionId, string>>;

export const APP_MENU_SETTINGS_INFO_PATH = '/settings?tab=info';

interface AppMenuHost {
    readonly environment: string;
    readonly windowLabel: string;
    readonly isMac: boolean;
}

/**
 * The menu bar belongs to the whole macOS app, so only the main window sets it.
 * On Windows and Linux an app menu adds a menu bar to every window, so it is left alone there.
 */
export function shouldInstallAppMenu({environment, windowLabel, isMac}: AppMenuHost): boolean {
    return environment === 'tauri' && windowLabel === 'main' && isMac;
}
