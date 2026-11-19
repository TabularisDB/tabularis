import {render, screen} from '@testing-library/react';
import {describe, it, expect} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {NavItem} from '@/components/layout/sidebar/NavItem';
import {Database} from 'lucide-react';

describe('NavItem', () => {
    it('renders label and icon', () => {
        render(
            <MemoryRouter>
                <NavItem to="/test" icon={Database} label="Test Label" />
            </MemoryRouter>,
        );

        expect(screen.getByText('Test Label')).toBeInTheDocument();
        // Icon rendering is harder to test directly without checking SVG internals, but we assume it renders if component mounts
    });

    it('is active on its own page only, not inside a page nested under it', () => {
        const renderAt = (path: string) =>
            render(
                <MemoryRouter initialEntries={[path]}>
                    <NavItem to="/connections" icon={Database} label="Connections" />
                </MemoryRouter>,
            );
        const onPage = renderAt('/connections');
        expect(screen.getByRole('link', {name: 'Connections'})).toHaveAttribute(
            'aria-current',
            'page',
        );
        expect(screen.getByTestId('rail-indicator')).toHaveClass('opacity-100');
        onPage.unmount();
        // The editor of an open connection has its own entry on the rail.
        renderAt('/connections/3f2a/editor');
        expect(screen.getByRole('link', {name: 'Connections'})).not.toHaveAttribute('aria-current');
        expect(screen.getByTestId('rail-indicator')).not.toHaveClass('opacity-100');
    });

    it('shows connection indicator when isConnected is true', () => {
        const {container} = render(
            <MemoryRouter>
                <NavItem to="/test" icon={Database} label="Test Label" isConnected={true} />
            </MemoryRouter>,
        );

        // The connected dot uses the shared success tone
        const indicator = container.querySelector('.bg-accent-success');
        expect(indicator).toBeInTheDocument();
    });

    it('does not show connection indicator when isConnected is false', () => {
        const {container} = render(
            <MemoryRouter>
                <NavItem to="/test" icon={Database} label="Test Label" isConnected={false} />
            </MemoryRouter>,
        );

        const indicator = container.querySelector('.bg-accent-success');
        expect(indicator).not.toBeInTheDocument();
    });
});
