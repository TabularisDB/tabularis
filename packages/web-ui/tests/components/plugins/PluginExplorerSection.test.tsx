import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {PluginExplorerSection} from '@/components/plugins/PluginExplorerSection';

const {openWorkspace, state} = vi.hoisted(() => ({
    openWorkspace: vi.fn(),
    state: {activeTab: null as null | Record<string, string>},
}));
vi.mock('@/hooks/usePluginWorkspace', () => ({usePluginWorkspace: () => ({openWorkspace})}));
vi.mock('@/hooks/usePluginApi', () => ({
    usePluginConnection: () => ({connectionId: 'connection-1'}),
}));
vi.mock('@/hooks/useEditor', () => ({useEditor: () => state}));
vi.mock('lucide-react', async (importOriginal) => await importOriginal());
const items = [
    {id: 'users', label: 'Users', icon: 'users'},
    {id: 'storage', label: 'Storage', icon: 'storage'},
];

describe('PluginExplorerSection', () => {
    beforeEach(() => {
        openWorkspace.mockReset();
        state.activeTab = null;
    });
    it('opens distinct services through the shared main-tab hook for any provider', () => {
        render(
            <PluginExplorerSection
                pluginId="supabase"
                providerName="Supabase"
                items={items}
                icon={<span>mark</span>}
            />,
        );
        fireEvent.click(screen.getByRole('button', {name: 'Users'}));
        fireEvent.click(screen.getByRole('button', {name: 'Storage'}));
        fireEvent.click(screen.getByRole('button', {name: 'Users'}));
        expect(openWorkspace.mock.calls.map(([options]) => options)).toEqual([
            {id: 'users', title: 'Supabase · Users', connectionId: 'connection-1'},
            {id: 'storage', title: 'Supabase · Storage', connectionId: 'connection-1'},
            {id: 'users', title: 'Supabase · Users', connectionId: 'connection-1'},
        ]);
        expect(document.querySelector('[style]')).toBeNull();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    it('selects a service only when provider, workspace and connection match', () => {
        state.activeTab = {
            type: 'plugin-workspace',
            pluginId: 'firebase',
            workspaceId: 'users',
            connectionId: 'connection-1',
        };
        const {rerender} = render(
            <PluginExplorerSection pluginId="firebase" providerName="Firebase" items={items} />,
        );
        expect(screen.getByRole('button', {name: 'Users'})).toHaveAttribute('aria-pressed', 'true');
        for (const patch of [
            {pluginId: 'other'},
            {connectionId: 'connection-2'},
            {workspaceId: 'other'},
            {type: 'console'},
        ]) {
            const previous = state.activeTab;
            state.activeTab = {...previous, ...patch};
            rerender(
                <PluginExplorerSection pluginId="firebase" providerName="Firebase" items={items} />,
            );
            expect(screen.getByRole('button', {name: 'Users'})).toHaveAttribute(
                'aria-pressed',
                'false',
            );
            state.activeTab = previous;
        }
    });
    it('collapses like a native section and uses the document icon for unknown item names', () => {
        render(
            <PluginExplorerSection
                pluginId="firebase"
                providerName="Firebase"
                items={[{id: 'documents', label: 'Documents', icon: 'constructor'}]}
            />,
        );
        expect(
            screen.getByRole('button', {name: 'Documents'}).querySelector('.lucide-file-text'),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Firebase'})).toHaveAttribute(
            'aria-expanded',
            'true',
        );
        fireEvent.click(screen.getByRole('button', {name: 'Firebase'}));
        expect(screen.getByRole('button', {name: 'Firebase'})).toHaveAttribute(
            'aria-expanded',
            'false',
        );
        expect(screen.queryByRole('button', {name: 'Documents'})).not.toBeInTheDocument();
    });

    it('shows scope errors inline and disables unavailable entries', () => {
        openWorkspace.mockImplementation(() => {
            throw new Error('Select the workspace connection');
        });
        const {rerender} = render(
            <PluginExplorerSection
                pluginId="appwrite"
                providerName="Appwrite"
                connectionId="connection-2"
                items={items}
            />,
        );
        fireEvent.click(screen.getByRole('button', {name: 'Users'}));
        expect(screen.getByRole('alert')).toHaveTextContent('Select the workspace connection');
        rerender(
            <PluginExplorerSection
                pluginId="appwrite"
                providerName="Appwrite"
                disabled
                items={items}
            />,
        );
        expect(screen.getByRole('button', {name: 'Users'})).toBeDisabled();
    });
});
