import {render, screen, fireEvent} from '@testing-library/react';
import {describe, it, expect, vi} from 'vitest';
import {PluginWorkspaceShell} from '@/components/plugins/PluginWorkspaceShell';

vi.mock('lucide-react', async (importOriginal) => await importOriginal());

describe('PluginWorkspaceShell', () => {
    it('renders provider sections, selected content and accessible keyboard navigation', () => {
        const select = vi.fn();
        render(
            <PluginWorkspaceShell
                title="Neon"
                subtitle="Development project"
                tabs={[
                    {id: 'database', label: 'Database'},
                    {id: 'files', label: 'Storage'},
                ]}
                activeTab="database"
                onTabChange={select}
            >
                <p>Database contents</p>
            </PluginWorkspaceShell>,
        );
        expect(screen.getByRole('heading', {name: 'Neon'})).toBeInTheDocument();
        const selected = screen.getByRole('tab', {name: 'Database'});
        expect(selected).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Database contents');
        fireEvent.keyDown(selected, {key: 'ArrowDown'});
        expect(select).toHaveBeenLastCalledWith('files');
        expect(screen.getByRole('tab', {name: 'Storage'})).toHaveFocus();
    });
    it('supports unrelated provider sections and actions without database assumptions', () => {
        render(
            <PluginWorkspaceShell
                title="Firebase"
                tabs={[
                    {id: 'documents', label: 'Documents'},
                    {id: 'rules', label: 'Security rules'},
                ]}
                activeTab="rules"
                onTabChange={vi.fn()}
                actions={<button>Open console</button>}
            >
                <p>Rules editor</p>
            </PluginWorkspaceShell>,
        );
        expect(screen.getByRole('tab', {name: 'Security rules'})).toHaveAttribute(
            'aria-selected',
            'true',
        );
        expect(screen.getByRole('button', {name: 'Open console'})).toBeInTheDocument();
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Rules editor');
    });
});
