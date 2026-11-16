import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {usePluginEvent} from '@/hooks/usePluginEvent';
import {publishPluginEvent} from '@/utils/pluginEvents';

describe('usePluginEvent', () => {
    it('refreshes sibling views and removes subscriptions when a scope changes or unmounts', async () => {
        const first = vi.fn();
        const second = vi.fn();
        const a = renderHook(() => usePluginEvent('neon', 'branch-changed', first));
        const b = renderHook(({pluginId}) => usePluginEvent(pluginId, 'branch-changed', second), {
            initialProps: {pluginId: 'neon'},
        });
        await act(() =>
            publishPluginEvent('neon', 'branch-changed', {projectId: 'p', branchId: 'b'}),
        );
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
        b.rerender({pluginId: 'other'});
        await act(() => publishPluginEvent('neon', 'branch-changed', {}));
        expect(first).toHaveBeenCalledTimes(2);
        expect(second).toHaveBeenCalledOnce();
        a.unmount();
        await act(() => publishPluginEvent('neon', 'branch-changed', {}));
        expect(first).toHaveBeenCalledTimes(2);
        b.unmount();
    });
});
