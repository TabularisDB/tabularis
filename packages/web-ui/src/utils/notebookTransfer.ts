import type {PlatformCapabilities} from '@/platform/capabilities';
import type {NotebookState} from '@/types/notebook';
import {deserializeNotebook, serializeNotebook} from './notebookFile';
import {exportNotebookToHtml} from './notebookHtmlExport';
import {exportNotebookToMarkdown} from './notebookMarkdownExport';
import {exportNotebookToSql} from './notebookSqlExport';

const NOTEBOOK_FILTER = [{name: 'Tabularis Notebook', extensions: ['tabularis-notebook']}] as const;
const HTML_FILTER = [{name: 'HTML', extensions: ['html']}] as const;
const SQL_FILTER = [{name: 'SQL', extensions: ['sql']}] as const;
const MARKDOWN_FILTER = [{name: 'Markdown', extensions: ['md']}] as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

export interface ImportedNotebook {
    readonly title: string;
    readonly state: NotebookState;
}

export async function chooseNotebookImport(
    platform: PlatformCapabilities,
): Promise<ImportedNotebook | null> {
    const selected = await platform.chooseInputFile({filters: NOTEBOOK_FILTER});
    if (!selected) return null;
    const contents = await platform.readInputFile(selected.reference);
    const {title, cells, params, stopOnError} = deserializeNotebook(decoder.decode(contents));
    return {
        title,
        state: {cells, params, stopOnError},
    };
}

export function downloadNotebook(
    platform: PlatformCapabilities,
    title: string,
    state: NotebookState,
): Promise<boolean> {
    const notebook = serializeNotebook(title, state.cells, state.params, state.stopOnError);
    return platform.downloadFile({
        fileName: `${safeFileName(title)}.tabularis-notebook`,
        contents: encoder.encode(JSON.stringify(notebook, null, 2)),
        mimeType: 'application/json',
        filters: NOTEBOOK_FILTER,
    });
}

export function downloadNotebookHtml(
    platform: PlatformCapabilities,
    title: string,
    state: NotebookState,
): Promise<boolean> {
    return platform.downloadFile({
        fileName: `${safeFileName(title)}.html`,
        contents: encoder.encode(exportNotebookToHtml(title, state.cells)),
        mimeType: 'text/html;charset=utf-8',
        filters: HTML_FILTER,
    });
}

/** Outcome of a SQL source export: saved, cancelled in the save dialog, or nothing to export. */
export type NotebookSqlDownload = 'downloaded' | 'cancelled' | 'empty';

export async function downloadNotebookSql(
    platform: PlatformCapabilities,
    title: string,
    state: NotebookState,
): Promise<NotebookSqlDownload> {
    const sql = exportNotebookToSql(title, state.cells);
    if (sql === null) return 'empty';
    const downloaded = await platform.downloadFile({
        fileName: `${safeFileName(title)}.sql`,
        contents: encoder.encode(sql),
        mimeType: 'application/sql;charset=utf-8',
        filters: SQL_FILTER,
    });
    return downloaded ? 'downloaded' : 'cancelled';
}

/** Outcome of a Markdown export: saved, cancelled in the save dialog, or nothing to export. */
export type NotebookMarkdownDownload = 'downloaded' | 'cancelled' | 'empty';

export async function downloadNotebookMarkdown(
    platform: PlatformCapabilities,
    title: string,
    state: NotebookState,
): Promise<NotebookMarkdownDownload> {
    const markdown = exportNotebookToMarkdown(state.cells);
    if (markdown === null) return 'empty';
    const downloaded = await platform.downloadFile({
        fileName: `${safeFileName(title)}.md`,
        contents: encoder.encode(markdown),
        mimeType: 'text/markdown;charset=utf-8',
        filters: MARKDOWN_FILTER,
    });
    return downloaded ? 'downloaded' : 'cancelled';
}

function safeFileName(title: string): string {
    return title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Notebook';
}
