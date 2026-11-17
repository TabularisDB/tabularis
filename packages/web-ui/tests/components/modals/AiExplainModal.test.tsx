import {ScopedAiContext} from '@/contexts/ScopedAiContext';
import {render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {AiExplainModal} from '@/components/modals/AiExplainModal';

const {invokeMock, settingsMock, i18nMock} = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    settingsMock: {
        aiProvider: 'openai' as string | undefined,
        aiModel: 'test-model',
        language: 'auto',
    },
    i18nMock: {
        language: 'it',
        resolvedLanguage: 'it' as string | undefined,
    },
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({t: (key: string) => key, i18n: i18nMock}),
}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: settingsMock}),
}));

vi.mock('@/hooks/useEditorTheme', () => ({
    useEditorTheme: () => ({id: 'test-theme'}),
}));

vi.mock('@/themes/themeUtils', () => ({
    loadMonacoTheme: vi.fn(),
}));

vi.mock('@/components/ui/LazyMonaco', () => ({
    MonacoEditor: () => null,
}));

vi.mock('@/components/ui/Modal', () => ({
    Modal: ({isOpen, children}: {isOpen: boolean; children: React.ReactNode}) =>
        isOpen ? <div>{children}</div> : null,
}));

describe('AiExplainModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settingsMock.aiProvider = 'openai';
        invokeMock.mockResolvedValue('Spiegazione');
        settingsMock.language = 'auto';
        i18nMock.language = 'it';
        i18nMock.resolvedLanguage = 'it';
    });

    it('uses the resolved UI language when the language is set to auto', async () => {
        render(<AiExplainModal isOpen onClose={vi.fn()} query="SELECT 1" />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith('explain_ai_query', {
                req: {
                    provider: 'openai',
                    model: 'test-model',
                    query: 'SELECT 1',
                    language: 'Italiano',
                },
            });
        });
        expect(await screen.findByText('Spiegazione')).toBeInTheDocument();
    });

    it('falls back to i18n.language when resolvedLanguage is missing', async () => {
        i18nMock.resolvedLanguage = undefined;
        i18nMock.language = 'pt-BR';

        render(<AiExplainModal isOpen onClose={vi.fn()} query="SELECT 1" />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith(
                'explain_ai_query',
                expect.objectContaining({
                    req: expect.objectContaining({language: 'Português (Brasil)'}),
                }),
            );
        });
    });

    it('keeps an explicitly selected language', async () => {
        settingsMock.language = 'de';

        render(<AiExplainModal isOpen onClose={vi.fn()} query="SELECT 1" />);

        await waitFor(() => {
            expect(invokeMock).toHaveBeenCalledWith(
                'explain_ai_query',
                expect.objectContaining({
                    req: expect.objectContaining({language: 'Deutsch'}),
                }),
            );
        });
    });
});

vi.mock('@/hooks/useTabularisClient', () => {
    const client = {call: (...args: unknown[]) => invokeMock(...args)};
    return {useTabularisClient: () => client};
});

it('explains in the authorized workspace without global AI settings or schema reads', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue('Explanation from operator provider');
    settingsMock.aiProvider = undefined;
    settingsMock.language = 'de';
    render(
        <ScopedAiContext.Provider value={{provider: 'openrouter', model: 'fixed-model'}}>
            <AiExplainModal
                isOpen
                onClose={vi.fn()}
                query="SELECT 42"
                connectionId="allowed"
                database="app"
                schema="public"
            />
        </ScopedAiContext.Provider>,
    );
    expect(await screen.findByText('Explanation from operator provider')).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith('scoped_ai_explain', {
        connectionId: 'allowed',
        database: 'app',
        schema: 'public',
        query: 'SELECT 42',
        language: 'Deutsch',
    });
    expect(screen.getByText(/openrouter \/ fixed-model/)).toBeInTheDocument();
});
