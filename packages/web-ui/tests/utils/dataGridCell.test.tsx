import {describe, it, expect} from 'vitest';
import {render} from '@testing-library/react';
import {renderDefaultCellContent} from '@/utils/dataGridCell';

/**
 * `renderDefaultCellContent` is the inlined replacement for react-table's
 * `flexRender` used by the memoized DataGrid row. The only branching it does is:
 * NULL / undefined  -> muted italic placeholder <span>
 * anything else      -> the formatted text verbatim (NO span), including the
 *                       falsy-but-present values 0, "", false.
 */
describe('renderDefaultCellContent', () => {
    const renderNode = (value: unknown, formatted: string) =>
        render(<div data-testid="wrap">{renderDefaultCellContent(value, formatted)}</div>);

    it('renders a muted italic span for null', () => {
        const {getByTestId} = renderNode(null, 'NULL');
        const span = getByTestId('wrap').querySelector('span');
        expect(span).not.toBeNull();
        expect(span?.className).toContain('text-muted');
        expect(span?.className).toContain('italic');
        expect(span?.textContent).toBe('NULL');
    });

    it('renders a muted italic span for undefined', () => {
        const {getByTestId} = renderNode(undefined, 'NULL');
        const span = getByTestId('wrap').querySelector('span');
        expect(span).not.toBeNull();
        expect(span?.className).toContain('text-muted');
        expect(span?.textContent).toBe('NULL');
    });

    it('keeps a muted NULL marker when the NULL label is empty (#1300)', () => {
        const {getByTestId} = renderNode(null, '');
        const marker = getByTestId('wrap').querySelector('[data-null-marker]');
        expect(marker).not.toBeNull();
        expect(marker?.className).toContain('text-muted');
        // An empty string stays a plain, unmarked value.
        const {getAllByTestId} = renderNode('', '');
        expect(getAllByTestId('wrap')[1].querySelector('[data-null-marker]')).toBeNull();
    });

    it('renders plain text (no span) for a normal string value', () => {
        const {getByTestId} = renderNode('hello', 'hello');
        const wrap = getByTestId('wrap');
        expect(wrap.querySelector('span')).toBeNull();
        expect(wrap.textContent).toBe('hello');
    });

    it.each([
        ['number zero', 0, '0'],
        ['empty string', '', ''],
        ['boolean false', false, 'false'],
    ])(
        'treats falsy-but-present value (%s) as a real value, not NULL',
        (_label, value, formatted) => {
            const {getByTestId} = renderNode(value, formatted);
            const wrap = getByTestId('wrap');
            // Must NOT fall into the null/undefined placeholder branch.
            expect(wrap.querySelector('span.text-muted')).toBeNull();
            expect(wrap.textContent).toBe(formatted);
        },
    );

    it('shows the formatted argument verbatim, not the raw value', () => {
        // The display string is computed upstream; this helper must not re-format.
        const {getByTestId} = renderNode(1234567, '1,234,567');
        expect(getByTestId('wrap').textContent).toBe('1,234,567');
    });
});
