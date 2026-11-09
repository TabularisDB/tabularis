import {describe, expect, it} from 'vitest';
import {cleanTabForStorage, restoreTabFromStorage} from '@/utils/tabCleaner';
import {createInitialTabState} from '@/utils/editor';

describe('plugin workspace persistence', () => {
    it('persists identity without SQL, result data, credentials, or runtime state', () => {
        const tab = {
            ...createInitialTabState('connection-1', {
                id: 'tab-1',
                title: 'Provider',
                type: 'plugin-workspace',
                pluginId: 'custom',
                workspaceId: 'services',
            }),
            query: 'secret query',
            queryParams: {token: 'secret'},
            flowState: {nodes: [], edges: []},
            secret: 'secret',
            component: () => null,
        };
        const saved = cleanTabForStorage(tab);
        expect(saved).toEqual({
            id: 'tab-1',
            title: 'Provider',
            type: 'plugin-workspace',
            connectionId: 'connection-1',
            pluginId: 'custom',
            workspaceId: 'services',
            query: '',
            page: 1,
            activeTable: null,
            pkColumns: null,
        });
        const restored = restoreTabFromStorage({
            ...saved,
            query: 'stale SQL',
            queryParams: {secret: 'secret'},
        });
        expect(restored).toMatchObject({
            pluginId: 'custom',
            workspaceId: 'services',
            connectionId: 'connection-1',
            query: '',
            result: null,
            isLoading: false,
        });
        expect(restored.queryParams).toBeUndefined();
    });
});
