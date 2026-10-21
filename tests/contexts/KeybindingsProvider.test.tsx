import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {invoke} from '@tauri-apps/api/core';
import {KeybindingsProvider} from '@/contexts/KeybindingsProvider';
import {useKeybindings} from '@/hooks/useKeybindings';
import type {UserOverrides} from '@/utils/keybindings';

vi.mock('@tauri-apps/api/core');

const originalOverrides: UserOverrides = {
    open_settings: {
        mac: {metaKey: true, key: ',', code: 'Comma'},
        win: {ctrlKey: true, key: ',', code: 'Comma'},
    },
};

const wrapper = ({children}: {children: ReactNode}) => (
    <KeybindingsProvider>{children}</KeybindingsProvider>
);

describe('KeybindingsProvider', () => {
    beforeEach(() => {
        vi.mocked(invoke).mockReset();
        vi.mocked(invoke).mockImplementation((command: string) => {
            if (command === 'get_keybindings') {
                return Promise.resolve(originalOverrides);
            }
            if (command === 'save_keybindings') {
                return Promise.reject(new Error('disk full'));
            }
            return Promise.reject(new Error(`Unexpected command: ${command}`));
        });
    });

    it('should restore the previous override when persistence fails', async () => {
        const {result} = renderHook(() => useKeybindings(), {wrapper});
        await waitFor(() => expect(result.current.overrides).toEqual(originalOverrides));

        let saveError: unknown;
        await act(async () => {
            try {
                await result.current.saveOverride(
                    'open_settings',
                    {metaKey: true, key: 'k', code: 'KeyK'},
                    {ctrlKey: true, key: 'k', code: 'KeyK'},
                );
            } catch (error) {
                saveError = error;
            }
        });

        expect(saveError).toEqual(new Error('disk full'));
        expect(result.current.overrides).toEqual(originalOverrides);
    });

    it('should restore a removed override when reset persistence fails', async () => {
        const {result} = renderHook(() => useKeybindings(), {wrapper});
        await waitFor(() => expect(result.current.overrides).toEqual(originalOverrides));

        let resetError: unknown;
        await act(async () => {
            try {
                await result.current.resetOverride('open_settings');
            } catch (error) {
                resetError = error;
            }
        });

        expect(resetError).toEqual(new Error('disk full'));
        expect(result.current.overrides).toEqual(originalOverrides);
    });
});
