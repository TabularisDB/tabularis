import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {NotebookToolbar} from '@/components/notebook/NotebookToolbar';

import type {NotebookViewMode} from '@/types/notebook';

vi.mock('lucide-react', async (importOriginal) => await importOriginal());

function renderToolbar(overrides: Partial<Parameters<typeof NotebookToolbar>[0]> = {}) {
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
        onClearOutputs: vi.fn(),
        canClearOutputs: false,
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        canUndo: false,
        canRedo: false,
        onToggleHistory: vi.fn(),
        historyOpen: false,
        viewMode: 'edit' as NotebookViewMode,
        onViewModeChange: vi.fn(),
        ...overrides,
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

    it('switches between Edit and Report modes and hides editing chrome in Report mode', () => {
        const onViewModeChange = vi.fn();
        const {rerender} = render(
            <NotebookToolbar
                onAddSqlCell={vi.fn()}
                onAddMarkdownCell={vi.fn()}
                onRunAll={vi.fn()}
                onExport={vi.fn()}
                onExportHtml={vi.fn()}
                onExportSql={vi.fn()}
                onImport={vi.fn()}
                isRunning={false}
                stopOnError={false}
                onToggleStopOnError={vi.fn()}
                onCollapseAll={vi.fn()}
                onExpandAll={vi.fn()}
                onClearOutputs={vi.fn()}
                canClearOutputs={false}
                onUndo={vi.fn()}
                onRedo={vi.fn()}
                canUndo={false}
                canRedo={false}
                onToggleHistory={vi.fn()}
                historyOpen={false}
                viewMode="edit"
                onViewModeChange={onViewModeChange}
            />,
        );

        const editBtn = screen.getByRole('button', {name: 'editor.notebook.editMode'});
        const reportBtn = screen.getByRole('button', {name: 'editor.notebook.reportMode'});
        expect(editBtn).toHaveAttribute('aria-pressed', 'true');
        expect(reportBtn).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTitle('editor.notebook.addCell')).toBeInTheDocument();
        expect(screen.getByTitle('editor.notebook.undo')).toBeInTheDocument();
        expect(screen.getByTitle('editor.notebook.import')).toBeInTheDocument();

        fireEvent.click(reportBtn);
        expect(onViewModeChange).toHaveBeenCalledWith('report');

        rerender(
            <NotebookToolbar
                onAddSqlCell={vi.fn()}
                onAddMarkdownCell={vi.fn()}
                onRunAll={vi.fn()}
                onExport={vi.fn()}
                onExportHtml={vi.fn()}
                onExportSql={vi.fn()}
                onImport={vi.fn()}
                isRunning={false}
                stopOnError={false}
                onToggleStopOnError={vi.fn()}
                onCollapseAll={vi.fn()}
                onExpandAll={vi.fn()}
                onClearOutputs={vi.fn()}
                canClearOutputs={false}
                onUndo={vi.fn()}
                onRedo={vi.fn()}
                canUndo={false}
                canRedo={false}
                onToggleHistory={vi.fn()}
                historyOpen={false}
                viewMode="report"
                onViewModeChange={onViewModeChange}
            />,
        );

        expect(screen.getByRole('button', {name: 'editor.notebook.editMode'})).toHaveAttribute(
            'aria-pressed',
            'false',
        );
        expect(screen.getByRole('button', {name: 'editor.notebook.reportMode'})).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.queryByTitle('editor.notebook.addCell')).not.toBeInTheDocument();
        expect(screen.queryByTitle('editor.notebook.undo')).not.toBeInTheDocument();
        expect(screen.queryByTitle('editor.notebook.import')).not.toBeInTheDocument();
        expect(screen.getByTitle('editor.notebook.runAllTooltip')).toBeInTheDocument();
        expect(screen.getByTitle('editor.notebook.export')).toBeInTheDocument();
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
