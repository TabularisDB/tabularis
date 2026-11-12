import {describe, it, expect} from 'vitest';
import {render, screen} from '@testing-library/react';
import {SqlEditorCursorStatus} from '@/components/ui/SqlEditorCursorStatus';

describe('SqlEditorCursorStatus', () => {
    it('shows the position alone when nothing is selected', () => {
        render(
            <SqlEditorCursorStatus
                status={{line: 3, column: 7, selectionCount: 0, selectedLength: 0}}
            />,
        );

        const status = screen.getByRole('status', {name: 'editor.cursorStatusLabel'});
        expect(status).toHaveTextContent(/^editor\.cursorPosition$/);
        expect(status).toHaveAttribute('aria-live', 'off');
        expect(status).toHaveAttribute('data-line', '3');
        expect(status).toHaveAttribute('data-column', '7');
        expect(status).toHaveAttribute('data-selections', '0');
        expect(status).toHaveAttribute('data-selected', '0');
        expect(status).not.toHaveAttribute('title');
    });

    it('adds the selected length for one selection and explains the unit', () => {
        render(
            <SqlEditorCursorStatus
                status={{line: 1, column: 1, selectionCount: 1, selectedLength: 12}}
            />,
        );

        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('editor.cursorPosition (editor.cursorSelection)');
        expect(status).toHaveAttribute('title', 'editor.cursorSelectionHint');
        expect(status).toHaveAttribute('data-selections', '1');
        expect(status).toHaveAttribute('data-selected', '12');
    });

    it('adds the selection count for several selections', () => {
        render(
            <SqlEditorCursorStatus
                status={{line: 2, column: 5, selectionCount: 3, selectedLength: 40}}
            />,
        );

        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('editor.cursorPosition (editor.cursorSelections)');
        expect(status).toHaveAttribute('data-selections', '3');
        expect(status).toHaveAttribute('data-selected', '40');
    });
});
