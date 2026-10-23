import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import ts from 'typescript';
import {VALID_SLOTS} from '@/types/pluginSlots';

const SLOT_ANCHORS: Readonly<Record<string, string>> = {
    'row-edit-modal.field.after': 'components/modals/NewRowModal.tsx',
    'row-edit-modal.footer.before': 'components/modals/NewRowModal.tsx',
    'row-editor-sidebar.field.after': 'components/ui/RowEditorPanel.tsx',
    'row-editor-sidebar.header.actions': 'components/ui/RowEditorPanel.tsx',
    'data-grid.toolbar.actions': 'components/ui/TableToolbar.tsx',
    'data-grid.context-menu.items': 'components/ui/DataGrid.tsx',
    'sidebar.footer.actions': 'components/layout/Sidebar.tsx',
    'settings.plugin.actions': 'components/settings/PluginsTab.tsx',
    'settings.plugin.before_settings': 'components/settings/PluginSettingsPage.tsx',
    'connection-modal.connection_content': 'components/modals/NewConnectionModal.tsx',
    'connection-modal.extra_fields': 'components/modals/NewConnectionModal.tsx',
};

describe('plugin slot parity', () => {
    it('should mount every public plugin API slot in the shared desktop and web UI', () => {
        expect(new Set(Object.keys(SLOT_ANCHORS))).toEqual(VALID_SLOTS);

        const publicContract = readFileSync(resolve('packages/plugin-api/src/slots.ts'), 'utf8');
        const parsed = ts.createSourceFile(
            'slots.ts',
            publicContract,
            ts.ScriptTarget.Latest,
            true,
        );
        const declaration = parsed.statements.find(
            (statement) =>
                ts.isTypeAliasDeclaration(statement) && statement.name.text === 'SlotContextMap',
        );
        if (
            !declaration ||
            !ts.isTypeAliasDeclaration(declaration) ||
            !ts.isTypeLiteralNode(declaration.type)
        )
            throw new Error('Missing public slot context map');
        const publicSlots = new Set(
            declaration.type.members.flatMap((member) =>
                member.name && ts.isStringLiteral(member.name) ? [member.name.text] : [],
            ),
        );
        expect(publicSlots).toEqual(VALID_SLOTS);
        for (const [slot, sourcePath] of Object.entries(SLOT_ANCHORS)) {
            const source = readFileSync(resolve('packages/web-ui/src', sourcePath), 'utf8');
            expect(source, slot).toContain(`name="${slot}"`);
        }
    });
});
