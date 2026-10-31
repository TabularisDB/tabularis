import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {EditorProvider} from '@/contexts/EditorProvider';
import {useEditor} from '@/hooks/useEditor';
const {database, call} = vi.hoisted(() => ({
    database: {activeConnectionId: null as string | null, activeDriver: 'neon'},
    call: vi.fn(),
}));
vi.mock('@/hooks/useDatabase', () => ({useDatabase: () => database}));
vi.mock('@/hooks/useTabularisClient', () => {
    const client = {call};
    return {useTabularisClient: () => client};
});
beforeEach(() => {
    database.activeConnectionId = null;
    call.mockReset();
});
describe('connection preference restoration', () => {
    it('never saves an empty new connection while its existing drafts are still loading', async () => {
        let resolvePreferences!: (value: unknown) => void;
        const preferences = new Promise((resolve) => {
            resolvePreferences = resolve;
        });
        call.mockImplementation((command: string) =>
            command === 'load_editor_preferences' ? preferences : Promise.resolve(undefined),
        );
        const {result, rerender} = renderHook(useEditor, {wrapper: EditorProvider});
        await act(async () => {});
        database.activeConnectionId = 'source';
        rerender();
        await waitFor(() =>
            expect(call).toHaveBeenCalledWith('load_editor_preferences', {connectionId: 'source'}),
        );
        expect(
            call.mock.calls.filter(([command]) => command === 'save_editor_preferences'),
        ).toHaveLength(0);
        await act(async () =>
            resolvePreferences({
                tabs: [
                    {
                        id: 'saved',
                        connectionId: 'source',
                        type: 'console',
                        title: 'Original',
                        query: 'SELECT 42;',
                    },
                ],
                active_tab_id: 'saved',
            }),
        );
        await waitFor(() => expect(result.current.activeTab?.query).toBe('SELECT 42;'));
        const saves = call.mock.calls.filter(([command]) => command === 'save_editor_preferences');
        expect(saves.length).toBeGreaterThan(0);
        expect(
            saves.every(([, payload]) =>
                payload.preferences.tabs.some((tab: {id: string}) => tab.id === 'saved'),
            ),
        ).toBe(true);
    });
});
