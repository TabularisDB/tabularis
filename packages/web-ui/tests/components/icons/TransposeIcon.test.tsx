import {render} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {TransposeIcon} from '@/components/icons/TransposeIcon';

describe('TransposeIcon', () => {
    it('renders at the given size in the current text colour', () => {
        const {container} = render(<TransposeIcon size={14} className="shrink-0" />);
        const svg = container.querySelector('svg')!;

        expect(svg).toHaveAttribute('width', '14');
        expect(svg).toHaveAttribute('height', '14');
        expect(svg).toHaveAttribute('stroke', 'currentColor');
        expect(svg).toHaveClass('shrink-0');
    });

    it('is decorative, so the toggle button carries the accessible name', () => {
        const {container} = render(<TransposeIcon />);
        expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });
});
