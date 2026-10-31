import {beforeEach, describe, expect, it, vi} from 'vitest';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {MemoryRouter, useLocation, useNavigate} from 'react-router-dom';
import {EditorProvider} from '@/contexts/EditorProvider';
import {useEditor} from '@/hooks/useEditor';
import {usePluginWorkspace} from '@/hooks/usePluginWorkspace';

const {database, connection, call} = vi.hoisted(() => ({
    database: {activeConnectionId: 'connection-1'},
    connection: {connectionId: 'connection-1'},
    call: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/hooks/useDatabase', () => ({useDatabase: () => database}));
vi.mock('@/hooks/usePluginApi', () => ({usePluginConnection: () => connection}));
vi.mock('@/hooks/useTabularisClient', () => {
    const client = {call};
    return {useTabularisClient: () => client};
});

const wrapper = ({children}: {children: ReactNode}) => (
    <MemoryRouter initialEntries={['/settings?tab=plugins']}>
        <EditorProvider>{children}</EditorProvider>
    </MemoryRouter>
);
const useWorkspace = () => ({
    editor: useEditor(),
    location: useLocation(),
    navigate: useNavigate(),
    workspace: usePluginWorkspace('custom-provider'),
});

describe('usePluginWorkspace', () => {
    beforeEach(() => {
        database.activeConnectionId = 'connection-1';
        connection.connectionId = 'connection-1';
        call.mockClear();
    });

    it('focuses one workspace even when opened twice before React renders', async () => {
        const {result} = renderHook(useWorkspace, {wrapper});
        await waitFor(() => expect(result.current.editor.tabs).toHaveLength(1));
        let first = '';
        let second = '';
        act(() => {
            first = result.current.workspace.openWorkspace({id: 'services', title: 'Services'});
            second = result.current.workspace.openWorkspace({id: 'services', title: 'Services'});
        });
        expect(second).toBe(first);
        expect(
            result.current.editor.tabs.filter((tab) => tab.type === 'plugin-workspace'),
        ).toHaveLength(1);
        act(() => result.current.editor.setActiveTabId(result.current.editor.tabs[0].id));
        act(() => result.current.workspace.openWorkspace({id: 'services', title: 'Services'}));
        expect(result.current.editor.activeTabId).toBe(first);
    });

    it('navigates from settings to the editor on both opening and focusing a workspace', async () => {
        const {result} = renderHook(useWorkspace, {wrapper});
        await waitFor(() => expect(result.current.editor.tabs).toHaveLength(1));
        expect(result.current.location.pathname).toBe('/settings');
        act(() => result.current.workspace.openWorkspace({id: 'users', title: 'Provider · Users'}));
        expect(result.current.location.pathname).toBe('/connections/connection-1/editor');
        act(() => result.current.navigate('/settings?tab=plugins'));
        expect(result.current.location.pathname).toBe('/settings');
        act(() => result.current.workspace.openWorkspace({id: 'users', title: 'Provider · Users'}));
        expect(result.current.location.pathname).toBe('/connections/connection-1/editor');
        expect(result.current.location.state).toBeNull();
        expect(
            result.current.editor.tabs.filter((tab) => tab.type === 'plugin-workspace'),
        ).toHaveLength(1);
    });

    it('preserves the connection editor URL and navigation state when already editing', async () => {
        const {result} = renderHook(useWorkspace, {wrapper});
        await waitFor(() => expect(result.current.editor.tabs).toHaveLength(1));
        act(() => result.current.navigate('/connections/connection-1/editor', {state: {marker:'keep'}}));
        act(() => result.current.workspace.openWorkspace({id:'branches', title:'Branches'}));
        expect(result.current.location.pathname).toBe('/connections/connection-1/editor');
        expect(result.current.location.state).toEqual({marker:'keep'});
    });

    it('keeps the same workspace isolated across connections', async () => {
        const {result, rerender} = renderHook(useWorkspace, {wrapper});
        await waitFor(() => expect(result.current.editor.tabs).toHaveLength(1));
        let first = '';
        act(() => {
            first = result.current.workspace.openWorkspace({id: 'services', title: 'Services'});
        });
        database.activeConnectionId = connection.connectionId = 'connection-2';
        rerender();
        await waitFor(() =>
            expect(result.current.editor.tabs[0]?.connectionId).toBe('connection-2'),
        );
        act(() => result.current.workspace.openWorkspace({id: 'services', title: 'Services'}));
        expect(result.current.editor.activeTabId).not.toBe(first);
        expect(result.current.editor.activeTab?.connectionId).toBe('connection-2');
        database.activeConnectionId = connection.connectionId = 'connection-1';
        rerender();
        act(() => result.current.workspace.openWorkspace({id: 'services', title: 'Services'}));
        expect(result.current.editor.activeTabId).toBe(first);
    });

    it('rejects explicit and explorer/editor scope mismatches without creating a tab', async () => {
        const {result, rerender} = renderHook(useWorkspace, {wrapper});
        await waitFor(() => expect(result.current.editor.tabs).toHaveLength(1));
        expect(() =>
            result.current.workspace.openWorkspace({
                id: 'services',
                title: 'Services',
                connectionId: 'connection-2',
            }),
        ).toThrow('Select the workspace connection');
        expect(result.current.location.pathname).toBe('/settings');
        connection.connectionId = 'connection-2';
        rerender();
        expect(() =>
            result.current.workspace.openWorkspace({id: 'services', title: 'Services'}),
        ).toThrow('not active in this editor');
        expect(result.current.editor.tabs).toHaveLength(1);
    });

    it('closes and reopens workspace metadata through the normal tab history', async () => {
        const {result} = renderHook(useWorkspace, {wrapper});
        await waitFor(() => expect(result.current.editor.tabs).toHaveLength(1));
        let id = '';
        act(() => {
            id = result.current.workspace.openWorkspace({id: 'services', title: 'Services'});
        });
        act(() => result.current.editor.closeTab(id));
        expect(result.current.editor.tabs.some((tab) => tab.id === id)).toBe(false);
        act(() => result.current.editor.reopenClosedTab());
        expect(result.current.editor.activeTab).toMatchObject({
            id,
            type: 'plugin-workspace',
            pluginId: 'custom-provider',
            workspaceId: 'services',
            connectionId: 'connection-1',
        });
    });

    it('rejects missing connection and invalid IDs', async () => {
        const {result, rerender} = renderHook(useWorkspace, {wrapper});
        await waitFor(() => expect(result.current.editor.tabs).toHaveLength(1));
        expect(() => result.current.workspace.openWorkspace({id: '', title: 'Services'})).toThrow(
            'workspace ID',
        );
        connection.connectionId = '';
        rerender();
        expect(() =>
            result.current.workspace.openWorkspace({id: 'services', title: 'Services'}),
        ).toThrow('Select the workspace connection');
    });
});
