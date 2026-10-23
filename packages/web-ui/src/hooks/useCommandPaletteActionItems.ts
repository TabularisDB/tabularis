import {useCallback, useContext, useMemo} from 'react';
import {useTranslation} from 'react-i18next';

import type {TableTarget} from '@/types/databaseObjects';
import {createBuiltInCommandItems} from '@/utils/builtInCommands';
import {createConnectionCommandItems} from '@/utils/connectionCommandItems';
import {formatShortcut} from '@/utils/keybindings';
import {useCommandPaletteState} from './useCommandPalette';
import {useKeybindings} from './useKeybindings';
import {useActiveCommandPaletteScope} from './useCommandPaletteScope';
import {SettingsContext} from '@/contexts/SettingsContext';

export function useCommandPaletteActionItems(
    onGenerateSql: (target: TableTarget) => void,
    onInspect: (target: TableTarget) => void,
) {
    const {t} = useTranslation();
    const {shortcuts, overrides, isMac} = useKeybindings();
    const {focusContext} = useCommandPaletteState();
    const scope = useActiveCommandPaletteScope();
    // Read the settings context directly so the palette also renders outside a
    // SettingsProvider (isolated hook usage); the app always provides it.
    const settingsContext = useContext(SettingsContext);
    const wordWrapEnabled = settingsContext?.settings.editorWordWrap ?? true;
    const toggleWordWrap = useCallback(() => {
        if (!settingsContext) return;
        // Functional updater: reading the current value at write time avoids a
        // stale snapshot overwriting a newer one when toggles fire in quick
        // succession (palette + settings toggle).
        settingsContext.updateSetting('editorWordWrap', (prev) => !(prev ?? true));
    }, [settingsContext]);

    return useMemo(() => {
        if (!scope) return [];

        const shortcutAvailable: Record<string, boolean> = {
            run_query_editor: !!focusContext?.inMonaco,
            run_all_editor: !!focusContext?.inMonaco,
            copy_selection: !focusContext?.inEditable,
        };
        const getShortcut = (shortcutId: string) => {
            if (shortcutAvailable[shortcutId] === false) return undefined;
            const def = shortcuts.find((shortcut) => shortcut.id === shortcutId);
            return def ? formatShortcut(def, overrides, isMac) : undefined;
        };
        const connectionCategory = t('commandPalette.categories.connection');
        const builtInItems = createBuiltInCommandItems(
            scope,
            {
                openSettings: t('commandPalette.commands.openSettings'),
                openConnections: t('commandPalette.commands.openConnections'),
                newConsole: t('editor.quickNavigator.actions.newConsole'),
                openTableInConsole: t('commandPalette.commands.openTableInConsole'),
                inspectTable: t('editor.quickNavigator.actions.inspect'),
                generateSql: t('editor.quickNavigator.actions.generateSql'),
                countRows: t('editor.quickNavigator.actions.countRows'),
                navigationCategory: t('commandPalette.categories.navigation'),
                connectionCategory,
                editorCategory: t('settings.shortcuts.categories.editor'),
                tableCategory: t('commandPalette.categories.table'),
                resultCategory: t('editor.multiResult.results'),
                toggleWordWrapEnable: t('commandPalette.commands.toggleWordWrapEnable'),
                toggleWordWrapDisable: t('commandPalette.commands.toggleWordWrapDisable'),
                copySelectedCells: (count) => t('dataGrid.copyCells', {count}),
                copySelectedRows: (count) => t('dataGrid.copyRows', {count}),
                copySelectedColumns: (count) => t('dataGrid.copySelectedColumns', {count}),
                copyColumnValuesAsSqlIn: t('dataGrid.copyColumnValuesIn'),
                copyAllRows: (count) =>
                    count == null ? t('dataGrid.copyAll') : t('dataGrid.copyAllRows', {count}),
            },
            {generateSql: onGenerateSql, inspect: onInspect},
            getShortcut,
            {wordWrapEnabled, toggleWordWrap},
        );

        const connectionItems = scope.runtime.switchConnection
            ? createConnectionCommandItems({
                  activeConnectionId: scope.connectionId,
                  connections: scope.connections ?? [],
                  group: connectionCategory,
                  switchConnection: scope.runtime.switchConnection,
              })
            : [];

        return [...builtInItems, ...connectionItems];
    }, [
        onGenerateSql,
        onInspect,
        scope,
        t,
        shortcuts,
        overrides,
        isMac,
        focusContext,
        wordWrapEnabled,
        toggleWordWrap,
    ]);
}
