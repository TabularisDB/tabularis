import {describe, it, expect} from 'vitest';
import {render} from '@testing-library/react';
import {SqlMatchExcerpt} from '@/components/ui/SqlMatchExcerpt';

describe('SqlMatchExcerpt', () => {
    const excerpt = {
        before: 'WHERE a = ',
        match: '<b>x</b>',
        after: ' AND c',
        truncatedStart: true,
        truncatedEnd: true,
    };

    it('renders the excerpt as text with the match highlighted and ellipses at the cut ends', () => {
        const {container} = render(<SqlMatchExcerpt excerpt={excerpt} />);
        const mark = container.querySelector('mark');

        expect(mark?.textContent).toBe('<b>x</b>');
        expect(container.querySelector('b')).toBeNull();
        expect(container.textContent).toBe('…WHERE a = <b>x</b> AND c…');
    });

    it('omits the ellipses when nothing was cut', () => {
        const {container} = render(
            <SqlMatchExcerpt excerpt={{...excerpt, truncatedStart: false, truncatedEnd: false}} />,
        );
        expect(container.textContent).toBe('WHERE a = <b>x</b> AND c');
    });

    it('clamps to two lines with the Tailwind utility', () => {
        const {container} = render(<SqlMatchExcerpt excerpt={excerpt} />);
        const root = container.firstElementChild as HTMLElement;

        expect(root.className).toContain('line-clamp-2');
        expect(root.getAttribute('style')).toBeNull();
    });
});
