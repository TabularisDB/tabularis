import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {TextExpansionEditor} from '@/components/ui/TextExpansionEditor';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: {count?: number}) =>
            options?.count !== undefined ? `${key}=${options.count}` : key,
    }),
}));

vi.mock('@/components/ui/CellCodeEditor', () => ({
    CellCodeEditor: ({
        value,
        onChange,
        readOnly,
    }: {
        value: string;
        onChange: (next: string) => void;
        readOnly: boolean;
    }) => (
        <textarea
            data-testid="editor"
            value={value}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
}));

vi.mock('@/components/ui/CellDiffEditor', () => ({
    CellDiffEditor: () => null,
}));

const stats = () => screen.getByTestId('text-stats').textContent;

describe('TextExpansionEditor text statistics', () => {
    it('shows zero counts for empty text', () => {
        render(
            <TextExpansionEditor value="" readOnly={false} onSave={vi.fn()} onCancel={vi.fn()} />,
        );
        expect(stats()).toContain('textStats.characters=0');
        expect(stats()).toContain('textStats.lines=0');
        expect(stats()).toContain('textStats.bytes=0');
    });

    it('distinguishes code points from UTF-8 bytes', () => {
        render(<TextExpansionEditor value={'A😀'} readOnly onSave={vi.fn()} onCancel={vi.fn()} />);
        expect(stats()).toContain('textStats.characters=2');
        expect(stats()).toContain('textStats.lines=1');
        expect(stats()).toContain('textStats.bytes=5');
    });

    it('updates as the draft changes without saving', () => {
        const onSave = vi.fn();
        render(
            <TextExpansionEditor value="ab" readOnly={false} onSave={onSave} onCancel={vi.fn()} />,
        );
        fireEvent.change(screen.getByTestId('editor'), {target: {value: 'ab\ncd'}});
        expect(stats()).toContain('textStats.characters=5');
        expect(stats()).toContain('textStats.lines=2');
        expect(stats()).toContain('textStats.bytes=5');
        expect(onSave).not.toHaveBeenCalled();
    });
});
