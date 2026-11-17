import {describe, expect, it, vi} from 'vitest';
import type {PlatformCapabilities} from '@/platform/capabilities';
import type {NotebookState} from '@/types/notebook';
import {
    chooseNotebookImport,
    downloadNotebook,
    downloadNotebookHtml,
    downloadNotebookMarkdown,
    downloadNotebookSql,
} from '@/utils/notebookTransfer';

const state: NotebookState = {
    cells: [
        {
            id: 'cell-1',
            type: 'sql',
            content: 'SELECT 42 AS answer',
            name: 'Answer',
            chartConfig: {
                type: 'bar',
                labelColumn: 'answer',
                valueColumns: ['answer'],
            },
        },
        {id: 'cell-2', type: 'markdown', content: '# Results'},
    ],
    params: [{name: 'region', value: 'eu'}],
    stopOnError: true,
};

function platformFixture(overrides: Partial<PlatformCapabilities>): PlatformCapabilities {
    return overrides as PlatformCapabilities;
}

describe('notebookTransfer', () => {
    it('imports the desktop-compatible notebook format through an opaque reference', async () => {
        const contents = new TextEncoder().encode(
            JSON.stringify({
                version: 2,
                title: 'Imported',
                createdAt: '2026-08-22T00:00:00Z',
                cells: [
                    {
                        type: 'sql',
                        content: 'SELECT 42 AS answer',
                        name: 'Answer',
                        chartConfig: state.cells[0].chartConfig,
                    },
                ],
                params: state.params,
                stopOnError: true,
            }),
        );
        const chooseInputFile = vi.fn().mockResolvedValue({
            name: 'import.tabularis-notebook',
            reference: 'opaque-browser-file',
        });
        const readInputFile = vi.fn().mockResolvedValue(contents);

        await expect(
            chooseNotebookImport(platformFixture({chooseInputFile, readInputFile})),
        ).resolves.toMatchObject({
            title: 'Imported',
            state: {
                stopOnError: true,
                params: state.params,
                cells: [
                    {
                        type: 'sql',
                        content: 'SELECT 42 AS answer',
                        name: 'Answer',
                        chartConfig: state.cells[0].chartConfig,
                    },
                ],
            },
        });
        expect(readInputFile).toHaveBeenCalledWith('opaque-browser-file');
    });

    it('exports notebook JSON through the platform download adapter', async () => {
        const downloadFile = vi.fn().mockResolvedValue(true);

        await expect(
            downloadNotebook(platformFixture({downloadFile}), 'Revenue / 2026', state),
        ).resolves.toBe(true);

        const request = downloadFile.mock.calls[0][0];
        expect(request.fileName).toBe('Revenue___2026.tabularis-notebook');
        expect(request.mimeType).toBe('application/json');
        expect(JSON.parse(new TextDecoder().decode(request.contents))).toMatchObject({
            version: 2,
            title: 'Revenue / 2026',
            stopOnError: true,
            params: state.params,
            cells: [
                {
                    type: 'sql',
                    content: 'SELECT 42 AS answer',
                    chartConfig: state.cells[0].chartConfig,
                },
                {type: 'markdown', content: '# Results'},
            ],
        });
    });

    it('preserves HTML export through the same browser-safe download adapter', async () => {
        const downloadFile = vi.fn().mockResolvedValue(true);

        await downloadNotebookHtml(platformFixture({downloadFile}), 'Revenue', state);

        const request = downloadFile.mock.calls[0][0];
        expect(request.fileName).toBe('Revenue.html');
        expect(request.mimeType).toBe('text/html;charset=utf-8');
        const html = new TextDecoder().decode(request.contents);
        expect(html).toContain('Revenue');
        expect(html).toContain('SELECT 42 AS answer');
        expect(html).toContain('Results');
    });

    it('exports SQL cell source through the platform download adapter', async () => {
        const downloadFile = vi.fn().mockResolvedValue(true);

        await expect(
            downloadNotebookSql(platformFixture({downloadFile}), 'Revenue / été', state),
        ).resolves.toBe('downloaded');

        const request = downloadFile.mock.calls[0][0];
        expect(request.fileName).toBe('Revenue____t_.sql');
        expect(request.mimeType).toBe('application/sql;charset=utf-8');
        expect(request.filters).toEqual([{name: 'SQL', extensions: ['sql']}]);
        const sql = new TextDecoder('utf-8', {fatal: true}).decode(request.contents);
        expect(sql).toContain('-- Tabularis notebook: Revenue / été');
        expect(sql).toContain('-- ---- Cell 1: Answer ----\nSELECT 42 AS answer\n');
        expect(sql).not.toContain('# Results');
        expect(sql).not.toContain('eu');
    });

    it('reports a cancelled SQL save dialog', async () => {
        const downloadFile = vi.fn().mockResolvedValue(false);

        await expect(
            downloadNotebookSql(platformFixture({downloadFile}), 'Revenue', state),
        ).resolves.toBe('cancelled');
        expect(downloadFile).toHaveBeenCalledOnce();
    });

    it('does not open a save dialog when there is no SQL to export', async () => {
        const downloadFile = vi.fn().mockResolvedValue(true);

        await expect(
            downloadNotebookSql(platformFixture({downloadFile}), 'Notes', {
                cells: [{id: 'md', type: 'markdown', content: 'SELECT in prose'}],
            }),
        ).resolves.toBe('empty');
        expect(downloadFile).not.toHaveBeenCalled();
    });

    it('falls back to a default SQL file name for titles with no safe characters', async () => {
        const downloadFile = vi.fn().mockResolvedValue(true);

        await downloadNotebookSql(platformFixture({downloadFile}), '', state);

        expect(downloadFile.mock.calls[0][0].fileName).toBe('Notebook.sql');
    });

    it('exports Markdown and SQL cell source through the platform download adapter', async () => {
        const downloadFile = vi.fn().mockResolvedValue(true);

        await expect(
            downloadNotebookMarkdown(platformFixture({downloadFile}), 'Revenue / été', state),
        ).resolves.toBe('downloaded');

        const request = downloadFile.mock.calls[0][0];
        expect(request.fileName).toBe('Revenue____t_.md');
        expect(request.mimeType).toBe('text/markdown;charset=utf-8');
        expect(request.filters).toEqual([{name: 'Markdown', extensions: ['md']}]);
        const markdown = new TextDecoder('utf-8', {fatal: true}).decode(request.contents);
        expect(markdown).toBe('```sql\nSELECT 42 AS answer\n```\n\n# Results\n');
        expect(markdown).not.toContain('eu');
    });

    it('reports a cancelled Markdown save dialog', async () => {
        const downloadFile = vi.fn().mockResolvedValue(false);

        await expect(
            downloadNotebookMarkdown(platformFixture({downloadFile}), 'Revenue', state),
        ).resolves.toBe('cancelled');
        expect(downloadFile).toHaveBeenCalledOnce();
    });

    it('does not open a save dialog when there is no Markdown source to export', async () => {
        const downloadFile = vi.fn().mockResolvedValue(true);

        await expect(
            downloadNotebookMarkdown(platformFixture({downloadFile}), 'Notes', {
                cells: [
                    {id: 'md', type: 'markdown', content: '  '},
                    {id: 'sql', type: 'sql', content: ''},
                ],
            }),
        ).resolves.toBe('empty');
        expect(downloadFile).not.toHaveBeenCalled();
    });

    it('propagates a failed Markdown write to the caller', async () => {
        const downloadFile = vi.fn().mockRejectedValue(new Error('disk full'));

        await expect(
            downloadNotebookMarkdown(platformFixture({downloadFile}), 'Revenue', state),
        ).rejects.toThrow('disk full');
    });
});
