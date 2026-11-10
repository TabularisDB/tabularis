import {fireEvent, render, screen} from '@testing-library/react';
import {describe, it, expect, vi} from 'vitest';
import {ConnectionGroupFolder} from '@/components/layout/sidebar/ConnectionGroupFolder';

const renderFolder = (overrides: Partial<Parameters<typeof ConnectionGroupFolder>[0]> = {}) =>
    render(
        <ConnectionGroupFolder
            name="PG-PROD"
            path="PG / PG-PROD"
            count={2}
            isCollapsed={false}
            hasActiveConnection={false}
            onToggle={vi.fn()}
            {...overrides}
        >
            <span>child connection</span>
        </ConnectionGroupFolder>,
    );

describe('ConnectionGroupFolder', () => {
    it('shows its connections and reports itself expanded', () => {
        renderFolder();

        expect(screen.getByText('child connection')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'PG / PG-PROD'})).toHaveAttribute(
            'aria-expanded',
            'true',
        );
    });

    it('hides its connections when collapsed', () => {
        renderFolder({isCollapsed: true});

        expect(screen.queryByText('child connection')).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'PG / PG-PROD'})).toHaveAttribute(
            'aria-expanded',
            'false',
        );
    });

    it('toggles on click', () => {
        const onToggle = vi.fn();
        renderFolder({onToggle});

        fireEvent.click(screen.getByRole('button', {name: 'PG / PG-PROD'}));

        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('marks a collapsed folder that hides the active connection', () => {
        renderFolder({isCollapsed: true, hasActiveConnection: true});

        expect(screen.getByTestId('rail-indicator')).toHaveClass('h-8');
    });

    it('leaves the marker to the connection itself while expanded', () => {
        renderFolder({hasActiveConnection: true});

        expect(screen.getByTestId('rail-indicator')).toHaveClass('h-4');
    });
});
