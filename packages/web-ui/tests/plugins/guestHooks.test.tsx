import {act, renderHook, waitFor} from '@testing-library/react';
import {useEffect, useState} from 'react';
import {describe, expect, it, vi} from 'vitest';
import {createGuestSettingsApi} from '@/plugins/sandbox/guestHooks';

describe('actual guest settings and translation hooks', () => {
    it('keeps effect dependencies stable across local rerenders while reading fresh host data', async () => {
        let context: Record<string, unknown> = {
            translations: {title: 'Services'},
            pluginSettings: {project: 'first'},
        };
        const call = vi.fn().mockResolvedValue(null);
        const hooks = createGuestSettingsApi(
            'provider',
            () => context,
            (next) => {
                context = next;
            },
            call,
        );
        const refresh = vi.fn().mockResolvedValue(undefined);
        const {result, rerender} = renderHook(() => {
            const t = hooks.usePluginTranslation('provider');
            const settings = hooks.usePluginSetting('provider');
            const [ready, setReady] = useState(false);
            useEffect(() => {
                void refresh(t('title'), settings.getSetting('project')).then(() => setReady(true));
            }, [t, settings.getSetting]);
            return {t, settings, ready};
        });
        await waitFor(() => expect(result.current.ready).toBe(true));
        const first = result.current;
        rerender();
        expect(result.current.t).toBe(first.t);
        expect(result.current.settings).toBe(first.settings);
        expect(refresh).toHaveBeenCalledOnce();
        context = {translations: {title: 'Dienste'}, pluginSettings: {project: 'second'}};
        rerender();
        expect(result.current.t('title')).toBe('Dienste');
        expect(result.current.settings.getSetting('project')).toBe('second');
        await act(() => result.current.settings.setSetting('project', 'third'));
        expect(call).toHaveBeenCalledWith('api.setting.set', 'project', 'third');
        expect(result.current.settings.getSetting('project')).toBe('third');
        expect(refresh).toHaveBeenCalledOnce();
    });
    it('preserves plugin ownership and propagates persistence failures without optimistic secret state', async () => {
        let context: Record<string, unknown> = {pluginSettings: {token: 'previous'}};
        const call = vi.fn().mockRejectedValue(new Error('Forbidden'));
        const hooks = createGuestSettingsApi(
            'provider',
            () => context,
            (next) => {
                context = next;
            },
            call,
        );
        const {result} = renderHook(() => hooks.usePluginSetting('provider'));
        await expect(result.current.setSetting('token', 'new')).rejects.toThrow('Forbidden');
        expect(result.current.getSetting('token')).toBe('previous');
        expect(() => renderHook(() => hooks.usePluginTranslation('foreign'))).toThrow(
            'own translations',
        );
        expect(() => renderHook(() => hooks.usePluginSetting('foreign'))).toThrow('own settings');
    });
});
