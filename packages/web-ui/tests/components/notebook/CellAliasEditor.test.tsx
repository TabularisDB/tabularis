import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {CellAliasEditor} from '@/components/notebook/CellAliasEditor';
import type {AliasChangeCheck} from '@/utils/notebookAlias';

vi.mock('lucide-react', () => vi.importActual('lucide-react'));
vi.mock('react-i18next', () => {
    const t = (key: string, options?: Record<string, unknown>) =>
        options ? `${key} ${JSON.stringify(options)}` : key;
    return {useTranslation: () => ({t})};
});

function open(alias?: string, onCommit = vi.fn<(a: string) => AliasChangeCheck>()) {
    render(<CellAliasEditor alias={alias} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole('button'));
    return {onCommit, input: screen.getByRole('textbox', {name: 'editor.notebook.alias.label'})};
}

describe('CellAliasEditor', () => {
    it('offers to add an alias, with the {{alias}} syntax in its help', () => {
        render(<CellAliasEditor onCommit={vi.fn()} />);
        const button = screen.getByRole('button', {name: 'editor.notebook.alias.add'});
        expect(button.getAttribute('title')).toContain('{{editor.notebook.alias.placeholder}}');
    });

    it('shows the current alias as the reference other cells write', () => {
        render(<CellAliasEditor alias="sales" onCommit={vi.fn()} />);
        const button = screen.getByRole('button');
        expect(button.textContent).toBe('{{sales}}');
        expect(button.getAttribute('title')).toContain('"reference":"{{sales}}"');
    });

    it('commits a valid alias on Enter and closes', () => {
        const {onCommit, input} = open(
            undefined,
            vi.fn<(a: string) => AliasChangeCheck>(() => ({ok: true, alias: 'sales'})),
        );
        fireEvent.change(input, {target: {value: 'sales'}});
        fireEvent.keyDown(input, {key: 'Enter'});
        expect(onCommit).toHaveBeenCalledWith('sales');
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('keeps the editor open with an accessible error when the alias is refused', () => {
        const {input} = open(
            undefined,
            vi.fn<(a: string) => AliasChangeCheck>(() => ({
                ok: false,
                issue: 'duplicate',
                conflictIndex: 2,
            })),
        );
        fireEvent.change(input, {target: {value: 'sales'}});
        fireEvent.keyDown(input, {key: 'Enter'});
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('editor.notebook.alias.issues.duplicate');
        expect(alert.textContent).toContain('"n":3');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.getAttribute('aria-describedby')).toBe(alert.id);
        // Typing clears the error; Escape discards the draft.
        fireEvent.change(input, {target: {value: 'sales2'}});
        expect(screen.queryByRole('alert')).toBeNull();
        fireEvent.keyDown(input, {key: 'Escape'});
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('lists every place that still uses an alias being renamed', () => {
        const {input} = open(
            'sales',
            vi.fn<(a: string) => AliasChangeCheck>(() => ({
                ok: false,
                issue: 'inUse',
                usage: {cellIndices: [2, 4], params: ['source']},
            })),
        );
        fireEvent.change(input, {target: {value: 'revenue'}});
        fireEvent.blur(input);
        const text = screen.getByRole('alert').textContent ?? '';
        expect(text).toContain('editor.notebook.alias.issues.inUse');
        expect(text).toContain('"reference":"{{sales}}"');
        expect(text).toContain('editor.notebook.alias.usageCell {\\"n\\":3}');
        expect(text).toContain('editor.notebook.alias.usageCell {\\"n\\":5}');
        expect(text).toContain('editor.notebook.alias.usageParam {\\"name\\":\\"source\\"}');
    });
});
