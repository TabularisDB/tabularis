import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createElement, type ReactNode} from 'react';
import {TabularisClientContext} from '@/contexts/TabularisClientContext';
import {DEFAULT_SETTINGS} from '@/contexts/SettingsContext';
import {useAiInlineCompletion} from '@/hooks/useAiInlineCompletion';
import type {SqlDiagnosticsTarget} from '@/hooks/useSqlDiagnostics';
import type {TabularisClient} from '@/api/client';

const mocks = vi.hoisted(() => ({
    settings: {
        aiEnabled: true,
        aiInlineCompletionEnabled: false,
        aiProvider: 'ollama',
        aiModel: 'local',
    },
    install: vi.fn(),
    dispose: vi.fn(),
}));
vi.mock('@/hooks/useSettings', () => ({useSettings: () => ({settings: mocks.settings})}));
vi.mock('@/utils/aiInlineCompletion', () => ({installAiInlineCompletion: mocks.install}));

const target = {editor: {}, monaco: {}} as SqlDiagnosticsTarget;
const context = {key: 'connection:db:public', schema: 'users', dialect: 'postgres'};
const client = {} as TabularisClient;
const wrapper = ({children}: {children: ReactNode}) =>
    createElement(TabularisClientContext.Provider, {value: client}, children);

describe('useAiInlineCompletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settings = {
            aiEnabled: true,
            aiInlineCompletionEnabled: false,
            aiProvider: 'ollama',
            aiModel: 'local',
        };
        mocks.install.mockReturnValue({dispose: mocks.dispose});
    });

    it('defaults off and does not register until explicitly enabled', () => {
        expect(DEFAULT_SETTINGS.aiInlineCompletionEnabled).toBe(false);
        const view = renderHook(() => useAiInlineCompletion(target, context), {wrapper});
        expect(mocks.install).not.toHaveBeenCalled();
        mocks.settings.aiInlineCompletionEnabled = true;
        view.rerender();
        expect(mocks.install).toHaveBeenCalledWith(target.editor, target.monaco, client, {
            ...context,
            key: JSON.stringify([context.key, null, null, null]),
            provider: 'ollama',
            model: 'local',
        });
        view.unmount();
        expect(mocks.dispose).toHaveBeenCalledOnce();
    });

    it('cancels registration on context, provider/model, editor and enablement changes', () => {
        mocks.settings.aiInlineCompletionEnabled = true;
        const view = renderHook(
            ({active, key}) => useAiInlineCompletion(active, {...context, key}),
            {wrapper, initialProps: {active: target, key: context.key}},
        );
        view.rerender({active: target, key: 'other-connection'});
        expect(mocks.dispose).toHaveBeenCalledTimes(1);
        act(() => {
            mocks.settings.aiModel = 'other-model';
        });
        view.rerender({active: target, key: 'other-connection'});
        expect(mocks.dispose).toHaveBeenCalledTimes(2);
        act(() => {
            mocks.settings.aiProvider = 'custom-openai';
        });
        view.rerender({active: {...target}, key: 'other-connection'});
        expect(mocks.dispose).toHaveBeenCalledTimes(3);
        mocks.settings.aiEnabled = false;
        view.rerender({active: target, key: 'other-connection'});
        expect(mocks.dispose).toHaveBeenCalledTimes(4);
        expect(mocks.install).toHaveBeenCalledTimes(4);
        view.unmount();
    });

    it('does not register for inactive embedded editors or missing provider', () => {
        mocks.settings.aiInlineCompletionEnabled = true;
        const view = renderHook(() => useAiInlineCompletion(target), {wrapper});
        expect(mocks.install).not.toHaveBeenCalled();
        view.unmount();
        mocks.settings.aiProvider = '';
        renderHook(() => useAiInlineCompletion(target, context), {wrapper});
        expect(mocks.install).not.toHaveBeenCalled();
    });

    it('invalidates suggestions when local provider configuration changes', () => {
        mocks.settings.aiInlineCompletionEnabled = true;
        const view = renderHook(() => useAiInlineCompletion(target, context), {wrapper});
        Object.assign(mocks.settings, {aiOllamaPort: 12345});
        view.rerender();
        expect(mocks.dispose).toHaveBeenCalledOnce();
        expect(mocks.install).toHaveBeenLastCalledWith(target.editor, target.monaco, client, {
            ...context,
            key: JSON.stringify([context.key, 12345, null, null]),
            provider: 'ollama',
            model: 'local',
        });
        view.unmount();
    });
});
