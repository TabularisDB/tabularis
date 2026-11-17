import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {NotebookToolbar} from '@/components/notebook/NotebookToolbar';

vi.mock('lucide-react', async (importOriginal) => await importOriginal());

function renderToolbar() {
    const props = {
        onAddSqlCell: vi.fn(),
        onAddMarkdownCell: vi.fn(),
        onRunAll: vi.fn(),
        onExport: vi.fn(),
        onExportHtml: vi.fn(),
        onExportSql: vi.fn(),
        onExportMarkdown: vi.fn(),
        onImport: vi.fn(),
        isRunning: false,
        stopOnError: false,
        onToggleStopOnError: vi.fn(),
        onCollapseAll: vi.fn(),
        onExpandAll: vi.fn(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        canUndo: false,
        canRedo: false,
        onToggleHistory: vi.fn(),
        historyOpen: false,
    };
    render(<NotebookToolbar {...props} />);
    return props;
}

describe('NotebookToolbar', () => {
    it('offers SQL source export in the export menu after the HTML export', () => {
        const props = renderToolbar();

        fireEvent.click(screen.getByTitle('editor.notebook.export'));
        const html = screen.getByRole('button', {name: 'editor.notebook.exportHtml'});
        const sql = screen.getByRole('button', {name: 'editor.notebook.exportSql'});
        expect(html.compareDocumentPosition(sql) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        fireEvent.click(sql);
        expect(props.onExportSql).toHaveBeenCalledOnce();
        expect(props.onExport).not.toHaveBeenCalled();
        expect(props.onExportHtml).not.toHaveBeenCalled();
    });

    it('offers Markdown export in the export menu after the SQL source export', () => {
        const props = renderToolbar();

        fireEvent.click(screen.getByTitle('editor.notebook.export'));
        const sql = screen.getByRole('button', {name: 'editor.notebook.exportSql'});
        const markdown = screen.getByRole('button', {name: 'editor.notebook.exportMarkdown'});
        expect(
            sql.compareDocumentPosition(markdown) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

        fireEvent.click(markdown);
        expect(props.onExportMarkdown).toHaveBeenCalledOnce();
        expect(props.onExport).not.toHaveBeenCalled();
        expect(props.onExportHtml).not.toHaveBeenCalled();
        expect(props.onExportSql).not.toHaveBeenCalled();
    });
});
