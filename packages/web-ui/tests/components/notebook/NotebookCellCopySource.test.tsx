import type {ComponentProps} from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NotebookCellHeader} from '../../../src/components/notebook/NotebookCellHeader';

const writeClipboard = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock('../../../src/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({writeClipboard}),
}));
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({showToast}),
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key}),
}));
vi.mock('../../../src/components/notebook/CellNameAiButton', () => ({
    CellNameAiButton: () => null,
}));

function makeProps(): ComponentProps<typeof NotebookCellHeader> {
    return {
        cellType: 'sql',
        index: 0,
        totalCells: 2,
        onMoveUp: vi.fn(),
        onMoveDown: vi.fn(),
        onDelete: vi.fn(),
        onToggleCollapse: vi.fn(),
        onNameChange: vi.fn(),
        cellContent: 'SELECT * FROM widgets',
    };
}

function copyButton() {
    return screen.getByRole('button', {name: 'editor.notebook.copySource'});
}

describe('NotebookCellHeader copy source', () => {
    beforeEach(() => {
        writeClipboard.mockReset().mockResolvedValue(undefined);
        showToast.mockReset();
    });

    it('copies the SQL cell source verbatim', async () => {
        const source = '  SELECT "Name", count(*)  \n-- keep me\nWHERE id = $1 /* $1 */';
        render(<NotebookCellHeader {...makeProps()} cellContent={source} />);

        fireEvent.click(copyButton());

        await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith(source));
    });

    it('copies the Markdown cell source verbatim', async () => {
        const source = '# Title\n\nPlaceholder {{value}} — ünïcode';
        render(<NotebookCellHeader {...makeProps()} cellType="markdown" cellContent={source} />);

        fireEvent.click(copyButton());

        await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith(source));
    });

    it('copies while the cell is collapsed', async () => {
        const source = 'SELECT 1;';
        render(<NotebookCellHeader {...makeProps()} isCollapsed cellContent={source} />);

        const button = copyButton();
        expect(button).toBeEnabled();

        fireEvent.click(button);

        await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith(source));
    });

    it('disables the action when the source is empty', () => {
        render(<NotebookCellHeader {...makeProps()} cellContent="" />);

        expect(copyButton()).toBeDisabled();
    });

    it('reports a clipboard failure', async () => {
        writeClipboard.mockRejectedValueOnce(new Error('denied'));
        render(<NotebookCellHeader {...makeProps()} cellContent="SELECT 1;" />);

        fireEvent.click(copyButton());

        await waitFor(() =>
            expect(showToast).toHaveBeenCalledWith('editor.notebook.copySourceFailed', {
                kind: 'error',
            }),
        );
    });
});
