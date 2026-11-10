import {describe, expect, it, vi} from 'vitest';
import {
    detectRawExplainLanguage,
    formatRawExplainOutput,
    formatXml,
    getRawExplainExtension,
    getRawExplainFileOptions,
    getRawExplainFormatLabel,
    saveRawExplainOutput,
} from '@/utils/explainRaw';
import type {PlatformCapabilities} from '@/platform/capabilities';

describe('explainRaw', () => {
    describe('detectRawExplainLanguage', () => {
        it('detects JSON documents and arrays', () => {
            expect(detectRawExplainLanguage('{"query_block": {}}')).toBe('json');
            expect(detectRawExplainLanguage('  [{"Plan": {}}]')).toBe('json');
        });

        it('detects XML from a leading tag or declaration', () => {
            expect(detectRawExplainLanguage('<ShowPlanXML/>')).toBe('xml');
            expect(detectRawExplainLanguage('\n<?xml version="1.0"?><a/>')).toBe('xml');
        });

        it('falls back to plaintext', () => {
            expect(detectRawExplainLanguage('Seq Scan on users (cost=0.00..1.00)')).toBe(
                'plaintext',
            );
            expect(detectRawExplainLanguage('')).toBe('plaintext');
        });
    });

    describe('formatXml', () => {
        it('indents nested elements one per line', () => {
            expect(formatXml('<a><b><c/></b></a>')).toBe(
                ['<a>', '  <b>', '    <c/>', '  </b>', '</a>'].join('\n'),
            );
        });

        it('keeps leaf text on the same line as its tags', () => {
            expect(formatXml('<a><name>users</name><empty></empty></a>')).toBe(
                ['<a>', '  <name>users</name>', '  <empty>', '  </empty>', '</a>'].join('\n'),
            );
        });

        it("does not split on '>' inside quoted attribute values", () => {
            const xml =
                '<RelOp NodeId="0"><ScalarOperator ScalarString="[o].[total]>(0) AND [c].[id]<(10)"/></RelOp>';
            expect(formatXml(xml)).toBe(
                [
                    '<RelOp NodeId="0">',
                    '  <ScalarOperator ScalarString="[o].[total]>(0) AND [c].[id]<(10)"/>',
                    '</RelOp>',
                ].join('\n'),
            );
        });

        it('keeps declarations, comments and CDATA as single lines', () => {
            const xml = '<?xml version="1.0"?><!-- plan --><a><![CDATA[SELECT 1 > 0]]></a>';
            expect(formatXml(xml)).toBe(
                [
                    '<?xml version="1.0"?>',
                    '<!-- plan -->',
                    '<a>',
                    '  <![CDATA[SELECT 1 > 0]]>',
                    '</a>',
                ].join('\n'),
            );
        });

        it('never indents below zero on unbalanced input', () => {
            expect(formatXml('</a><b/>')).toBe('</a>\n<b/>');
        });
    });

    describe('formatRawExplainOutput', () => {
        it('indents a single-line SHOWPLAN document', () => {
            const showplan =
                '<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.564"><BatchSequence><Batch><Statements><StmtSimple StatementText="SELECT 1"><QueryPlan><RelOp NodeId="0" PhysicalOp="Compute Scalar"/></QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>';
            const formatted = formatRawExplainOutput(showplan);
            const lines = formatted.split('\n');

            expect(lines).toHaveLength(13);
            expect(lines[0]).toBe(
                '<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.564">',
            );
            expect(lines[6]).toBe('            <RelOp NodeId="0" PhysicalOp="Compute Scalar"/>');
            expect(lines[12]).toBe('</ShowPlanXML>');
        });

        it('leaves XML that already spans several lines untouched', () => {
            const pretty = '<a>\n  <b/>\n</a>';
            expect(formatRawExplainOutput(pretty)).toBe(pretty);
        });

        it('returns JSON and text unchanged', () => {
            const json = '{"query_block":{"select_id":1}}';
            const text = 'Seq Scan on users  (cost=0.00..1.00 rows=1 width=4)';
            expect(formatRawExplainOutput(json)).toBe(json);
            expect(formatRawExplainOutput(text)).toBe(text);
        });
    });

    describe('getRawExplainExtension', () => {
        it('maps json to json', () => {
            expect(getRawExplainExtension('json')).toBe('json');
        });

        it('maps xml to xml', () => {
            expect(getRawExplainExtension('xml')).toBe('xml');
        });

        it('maps plaintext to txt', () => {
            expect(getRawExplainExtension('plaintext')).toBe('txt');
        });
    });

    describe('getRawExplainFormatLabel', () => {
        it('maps json to JSON', () => {
            expect(getRawExplainFormatLabel('json')).toBe('JSON');
        });

        it('maps xml to XML', () => {
            expect(getRawExplainFormatLabel('xml')).toBe('XML');
        });

        it('maps plaintext to Text', () => {
            expect(getRawExplainFormatLabel('plaintext')).toBe('Text');
        });
    });

    describe('getRawExplainFileOptions', () => {
        it('returns json options for json payload', () => {
            const options = getRawExplainFileOptions('{"plan":{}}');
            expect(options.defaultPath).toBe('explain.json');
            expect(options.filters).toEqual([
                {name: 'JSON', extensions: ['json']},
                {name: 'All files', extensions: ['*']},
            ]);
        });

        it('returns xml options for xml payload', () => {
            const options = getRawExplainFileOptions('<ShowPlanXML/>');
            expect(options.defaultPath).toBe('explain.xml');
            expect(options.filters).toEqual([
                {name: 'XML', extensions: ['xml']},
                {name: 'All files', extensions: ['*']},
            ]);
        });

        it('returns txt options for plaintext payload', () => {
            const options = getRawExplainFileOptions('Seq Scan on users');
            expect(options.defaultPath).toBe('explain.txt');
            expect(options.filters).toEqual([
                {name: 'Text', extensions: ['txt']},
                {name: 'All files', extensions: ['*']},
            ]);
        });
    });

    describe('saveRawExplainOutput', () => {
        function platformWith(downloadFile: ReturnType<typeof vi.fn>) {
            return {downloadFile} as unknown as PlatformCapabilities;
        }

        it('downloads the original content without modification', async () => {
            const downloadFile = vi.fn().mockResolvedValue(true);
            const raw = '{"query_block": {"cost": 10.5}}';

            const result = await saveRawExplainOutput(platformWith(downloadFile), raw);

            expect(result).toBe(true);
            // Content must match the original raw string exactly, not reformatted
            expect(downloadFile).toHaveBeenCalledExactlyOnceWith({
                fileName: 'explain.json',
                contents: new TextEncoder().encode(raw),
                mimeType: 'application/json',
                title: undefined,
                filters: [
                    {name: 'JSON', extensions: ['json']},
                    {name: 'All files', extensions: ['*']},
                ],
            });
        });

        it('preserves unformatted single-line XML when saving', async () => {
            const downloadFile = vi.fn().mockResolvedValue(true);
            const singleLineXml = '<ShowPlanXML><BatchSequence/></ShowPlanXML>';

            await saveRawExplainOutput(platformWith(downloadFile), singleLineXml);

            expect(downloadFile).toHaveBeenCalledWith(
                expect.objectContaining({
                    fileName: 'explain.xml',
                    contents: new TextEncoder().encode(singleLineXml),
                }),
            );
        });

        it('returns false when the user cancels', async () => {
            const downloadFile = vi.fn().mockResolvedValue(false);

            await expect(
                saveRawExplainOutput(platformWith(downloadFile), '{"test": true}'),
            ).resolves.toBe(false);
        });

        it('propagates download rejection', async () => {
            const downloadFile = vi.fn().mockRejectedValue(new Error('permission denied'));

            await expect(
                saveRawExplainOutput(platformWith(downloadFile), 'raw content'),
            ).rejects.toThrow('permission denied');
        });
    });
});
