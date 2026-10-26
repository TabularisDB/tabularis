import {describe, it, expect, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {ResultViewToggle} from '@/components/ui/ResultViewToggle';

describe('ResultViewToggle', () => {
    it('exposes a named group of two buttons with their pressed state', () => {
        render(<ResultViewToggle view="grid" onChange={vi.fn()} />);
        expect(
            screen.getByRole('group', {name: 'editor.resultChart.viewLabel'}),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'editor.resultChart.viewGrid'})).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.getByRole('button', {name: 'editor.resultChart.viewChart'})).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    it('reports the chosen view', () => {
        const onChange = vi.fn();
        render(<ResultViewToggle view="grid" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', {name: 'editor.resultChart.viewChart'}));
        expect(onChange).toHaveBeenCalledWith('chart');
    });

    it('uses native buttons with a visible focus style', () => {
        render(<ResultViewToggle view="chart" onChange={vi.fn()} />);
        for (const button of screen.getAllByRole('button')) {
            expect(button.tagName).toBe('BUTTON');
            expect(button).toHaveAttribute('type', 'button');
            expect(button.className).toContain('focus-visible:outline-focus');
        }
    });
});
