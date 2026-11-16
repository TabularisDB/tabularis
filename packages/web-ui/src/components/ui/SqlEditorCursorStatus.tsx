import {useTranslation} from 'react-i18next';
import type {EditorCursorStatus} from '@/utils/editorCursorStatus';

interface SqlEditorCursorStatusProps {
    status: EditorCursorStatus;
}

/**
 * Compact indicator for the SQL editor: the primary cursor's line and column,
 * plus the selection count and selected length when text is selected. Sits in
 * the editor's bottom padding so it never covers a line of SQL.
 *
 * The region is marked `aria-live="off"`: the status changes on every
 * keystroke and must not be announced each time. Its name still identifies it
 * for assistive technology that reads it on request.
 */
export function SqlEditorCursorStatus({status}: SqlEditorCursorStatusProps) {
    const {t} = useTranslation();
    const {line, column, selectionCount, selectedLength} = status;

    let selection: string | null = null;
    if (selectionCount === 1) {
        selection = t('editor.cursorSelection', {length: selectedLength});
    } else if (selectionCount > 1) {
        selection = t('editor.cursorSelections', {
            selections: selectionCount,
            length: selectedLength,
        });
    }

    return (
        <div
            role="status"
            aria-live="off"
            aria-label={t('editor.cursorStatusLabel')}
            title={selection === null ? undefined : t('editor.cursorSelectionHint')}
            className="absolute bottom-2 left-3 z-10 px-1.5 py-0.5 rounded text-[10px] leading-4 tabular-nums text-muted bg-elevated/80 border border-default backdrop-blur-sm select-none whitespace-nowrap"
            data-line={line}
            data-column={column}
            data-selections={selectionCount}
            data-selected={selectedLength}
        >
            {t('editor.cursorPosition', {line, column})}
            {selection === null ? null : ` (${selection})`}
        </div>
    );
}
