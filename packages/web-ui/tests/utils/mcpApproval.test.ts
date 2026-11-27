import {describe, expect, it} from 'vitest';
import {MCP_APPROVAL_LABELS, parseMcpApprovalMode} from '@/utils/mcpApproval';

describe('mcpApproval', () => {
    it.each(['all', 'writes_only', 'off'])('keeps the explicit override %s', (mode) => {
        expect(parseMcpApprovalMode(mode)).toBe(mode);
    });

    it.each(['', 'legacy', undefined, null])('uses inheritance for %s', (value) => {
        expect(parseMcpApprovalMode(value)).toBeNull();
    });

    it('has the picker strings and shared mode labels in all shipped locales', () => {
        const locales = import.meta.glob<Record<string, unknown>>('@/i18n/locales/*.json', {
            eager: true,
            import: 'default',
        });
        expect(Object.keys(locales)).toHaveLength(13);
        for (const [file, catalog] of Object.entries(locales)) {
            const {newConnection, mcp} = catalog;
            expect(newConnection, file).toMatchObject({
                mcpApprovalMode: expect.stringMatching(/\S/),
                mcpApprovalInherit: expect.stringContaining('{{mode}}'),
                mcpApprovalReadOnly: expect.stringMatching(/\S/),
            });
            expect(mcp, file).toMatchObject({
                safety: Object.fromEntries(
                    Object.values(MCP_APPROVAL_LABELS).map((key) => [
                        key.split('.').at(-1),
                        expect.stringMatching(/\S/),
                    ]),
                ),
            });
        }
    });
});
