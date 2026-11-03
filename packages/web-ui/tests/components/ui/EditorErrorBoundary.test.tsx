import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {MemoryRouter, Routes, Route} from 'react-router-dom';
import {EditorErrorBoundary} from '@/components/ui/EditorErrorBoundary';
import {EditorContext} from '@/contexts/EditorContext';
import type {EditorContextType} from '@/contexts/EditorContext';

vi.mock('@/components/layout/CommandPaletteScopeBridge', () => ({
    CommandPaletteScopeBridge: ({scopeId}: {scopeId: string}) => (
        <div data-testid={`command-scope-${scopeId}`} />
    ),
}));

const openExternalUrl = vi.fn(async (_url: string) => {});
vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({
        negotiation: {environment: 'tauri'},
        openExternalUrl,
    }),
}));

const {callMock, settingsMock} = vi.hoisted(() => ({
    callMock: vi.fn(),
    settingsMock: {
        aiEnabled: true,
        aiProvider: 'openai' as string | null,
        aiModel: 'test-model',
        language: 'en',
    },
}));
vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => ({call: callMock}),
}));
vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: settingsMock}),
}));

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return {promise, resolve, reject};
};

const HappyChild = () => <div data-testid="happy">happy editor</div>;

let shouldThrow = true;
let crashMessage = 'boom';
const Crasher = () => {
    if (shouldThrow) {
        throw new Error(crashMessage);
    }
    return <div data-testid="recovered">recovered editor</div>;
};

const buildEditorContext = (overrides: Partial<EditorContextType> = {}): EditorContextType => ({
    tabs: [],
    activeTabId: 'tab-1',
    activeTab: null,
    addTab: vi.fn(() => ''),
    openNotebook: vi.fn(),
    closeTab: vi.fn(),
    closeAllTabs: vi.fn(),
    closeOtherTabs: vi.fn(),
    closeTabsToLeft: vi.fn(),
    closeTabsToRight: vi.fn(),
    reopenClosedTab: vi.fn(),
    canReopenClosedTab: false,
    updateTab: vi.fn(),
    setActiveTabId: vi.fn(),
    getSchema: vi.fn(async () => []),
    ...overrides,
});

const renderAtEditor = (children: React.ReactNode, ctx: EditorContextType = buildEditorContext()) =>
    render(
        <EditorContext.Provider value={ctx}>
            <MemoryRouter initialEntries={['/editor']}>
                <Routes>
                    <Route
                        path="/editor"
                        element={<EditorErrorBoundary>{children}</EditorErrorBoundary>}
                    />
                    <Route
                        path="/connections"
                        element={<div data-testid="connections-page">connections</div>}
                    />
                </Routes>
            </MemoryRouter>
        </EditorContext.Provider>,
    );

describe('EditorErrorBoundary', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        shouldThrow = true;
        crashMessage = 'boom';
        callMock.mockReset();
        settingsMock.aiEnabled = true;
        settingsMock.aiProvider = 'openai';
        // React itself logs uncaught render errors via console.error before the
        // boundary handles them. Silence to keep test output clean.
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('renders children when no error is thrown', () => {
        renderAtEditor(<HappyChild />);
        expect(screen.getByTestId('happy')).toBeInTheDocument();
    });

    it('renders fallback UI with the error message when a child throws', () => {
        renderAtEditor(<Crasher />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('editor.errorBoundary.title')).toBeInTheDocument();
        expect(screen.getByText('boom')).toBeInTheDocument();
        expect(screen.getByTestId('command-scope-root')).toBeInTheDocument();
    });

    it('logs the caught error to console.error', () => {
        renderAtEditor(<Crasher />);

        const wasLoggedByBoundary = consoleErrorSpy.mock.calls.some(
            (args) =>
                typeof args[0] === 'string' &&
                args[0].includes('[Editor] render crash caught by error boundary'),
        );
        expect(wasLoggedByBoundary).toBe(true);
    });

    it('recovers when the user clicks retry and the child no longer throws', () => {
        renderAtEditor(<Crasher />);

        expect(screen.getByText('boom')).toBeInTheDocument();

        shouldThrow = false;
        fireEvent.click(screen.getByText('editor.errorBoundary.retry'));

        expect(screen.getByTestId('recovered')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('navigates to /connections when the user clicks back to connections', () => {
        renderAtEditor(<Crasher />);

        fireEvent.click(screen.getByText('editor.errorBoundary.backToConnections'));

        expect(screen.getByTestId('connections-page')).toBeInTheDocument();
    });

    it('closes the active tab and resets the boundary when the user clicks close current tab', () => {
        const closeTab = vi.fn();
        const ctx = buildEditorContext({activeTabId: 'tab-1', closeTab});

        renderAtEditor(<Crasher />, ctx);
        expect(screen.getByText('boom')).toBeInTheDocument();

        shouldThrow = false;
        fireEvent.click(screen.getByText('editor.errorBoundary.closeCurrentTab'));

        expect(closeTab).toHaveBeenCalledWith('tab-1');
        expect(screen.getByTestId('recovered')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('hides the close-current-tab button when there is no active tab', () => {
        const ctx = buildEditorContext({activeTabId: null});

        renderAtEditor(<Crasher />, ctx);

        expect(screen.queryByText('editor.errorBoundary.closeCurrentTab')).not.toBeInTheDocument();
        expect(screen.getByText('editor.errorBoundary.retry')).toBeInTheDocument();
    });

    it('copies the crash report while the details are collapsed', async () => {
        const writeText = vi.fn(async (_text: string) => {});
        Object.assign(navigator, {clipboard: {writeText}});

        renderAtEditor(<Crasher />);
        fireEvent.click(screen.getByText('editor.errorBoundary.copyReport'));

        await waitFor(() =>
            expect(screen.getByText('editor.errorBoundary.reportCopied')).toBeInTheDocument(),
        );
        const text = writeText.mock.calls[0][0];
        expect(text).toContain('Message: boom');
        expect(text).toContain('Mode: desktop');
        expect(text).toContain('Error stack:\nError: boom');
    });

    it('says so when the clipboard write fails', async () => {
        Object.assign(navigator, {
            clipboard: {writeText: vi.fn(async () => Promise.reject(new Error('denied')))},
        });

        renderAtEditor(<Crasher />);
        fireEvent.click(screen.getByText('editor.errorBoundary.copyReport'));

        expect(await screen.findByText('editor.errorBoundary.copyFailed')).toBeInTheDocument();
        expect(screen.getByText('editor.errorBoundary.copyReport')).toBeInTheDocument();
    });

    it('opens a prefilled bug report when the user clicks create issue', () => {
        openExternalUrl.mockClear();

        renderAtEditor(<Crasher />);
        fireEvent.click(screen.getByText('editor.errorBoundary.createIssue'));

        expect(openExternalUrl).toHaveBeenCalledTimes(1);
        const url = new URL(openExternalUrl.mock.calls[0][0]);
        expect(url.pathname).toBe('/TabularisDB/tabularis/issues/new');
        expect(url.searchParams.get('template')).toBe('bug_report.yml');
        expect(url.searchParams.get('logs')).toContain('Message: boom');
    });

    describe('Analyze with AI', () => {
        it('is hidden when AI is disabled or no provider is selected', () => {
            settingsMock.aiEnabled = false;
            const {unmount} = renderAtEditor(<Crasher />);
            expect(
                screen.queryByText('editor.errorBoundary.analyzeWithAi'),
            ).not.toBeInTheDocument();
            expect(screen.getByText('editor.errorBoundary.copyReport')).toBeInTheDocument();
            unmount();

            settingsMock.aiEnabled = true;
            settingsMock.aiProvider = null;
            renderAtEditor(<Crasher />);
            expect(
                screen.queryByText('editor.errorBoundary.analyzeWithAi'),
            ).not.toBeInTheDocument();
            expect(screen.getByText('editor.errorBoundary.createIssue')).toBeInTheDocument();
        });

        it('shows a loading state, then the analysis inline', async () => {
            const pending = deferred<string>();
            callMock.mockReturnValue(pending.promise);

            renderAtEditor(<Crasher />);
            fireEvent.click(screen.getByText('editor.errorBoundary.analyzeWithAi'));

            const button = screen.getByText('editor.errorBoundary.aiAnalyzing').closest('button');
            expect(button).toBeDisabled();

            pending.resolve('The SQL editor bundle failed to load. Reload the app.');

            expect(
                await screen.findByText('The SQL editor bundle failed to load. Reload the app.'),
            ).toBeInTheDocument();
            expect(screen.getByText('editor.errorBoundary.aiAnalysisTitle')).toBeInTheDocument();
            expect(screen.getByText('editor.errorBoundary.analyzeWithAi')).toBeEnabled();
        });

        it('sends the redacted report to the configured provider', async () => {
            crashMessage = 'connect postgres://admin:hunter2@db.internal/app failed';
            callMock.mockResolvedValue('analysis');

            renderAtEditor(<Crasher />);
            fireEvent.click(screen.getByText('editor.errorBoundary.analyzeWithAi'));

            await screen.findByText('analysis');
            expect(callMock).toHaveBeenCalledTimes(1);
            const [command, {req}] = callMock.mock.calls[0];
            expect(command).toBe('analyze_ai_crash_report');
            expect(req.provider).toBe('openai');
            expect(req.model).toBe('test-model');
            expect(req.language).toEqual(expect.any(String));
            expect(req.query).toContain(
                'Message: connect postgres://[redacted]@db.internal/app failed',
            );
            expect(req.query).toContain('Mode: desktop');
            expect(req.query).not.toContain('hunter2');
        });

        it('shows a failure inline and keeps recovery working', async () => {
            callMock.mockRejectedValue('Invalid API key');

            renderAtEditor(<Crasher />);
            fireEvent.click(screen.getByText('editor.errorBoundary.analyzeWithAi'));

            expect(
                await screen.findByText('editor.errorBoundary.aiAnalysisFailed'),
            ).toBeInTheDocument();
            expect(screen.getByText('Invalid API key')).toBeInTheDocument();
            expect(screen.getByText('editor.errorBoundary.analyzeWithAi')).toBeEnabled();

            shouldThrow = false;
            fireEvent.click(screen.getByText('editor.errorBoundary.retry'));
            expect(screen.getByTestId('recovered')).toBeInTheDocument();
        });

        it('ignores a response that arrives after the crash screen is gone', async () => {
            const pending = deferred<string>();
            callMock.mockReturnValue(pending.promise);

            renderAtEditor(<Crasher />);
            fireEvent.click(screen.getByText('editor.errorBoundary.analyzeWithAi'));

            shouldThrow = false;
            fireEvent.click(screen.getByText('editor.errorBoundary.retry'));
            expect(screen.getByTestId('recovered')).toBeInTheDocument();

            pending.resolve('late analysis');
            await pending.promise;

            expect(screen.getByTestId('recovered')).toBeInTheDocument();
            expect(screen.queryByText('late analysis')).not.toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });
});
