import {Component, useState} from 'react';
import type {ErrorInfo, ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router-dom';
import {AlertTriangle, Bug, Check, Copy, Home, RotateCcw, XCircle} from 'lucide-react';
import type {TFunction} from 'i18next';
import {useEditor} from '@/hooks/useEditor';
import {useCopyFeedback} from '@/hooks/useCopyFeedback';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {
    buildEditorCrashIssueUrl,
    formatEditorCrashReport,
    type CrashReportMode,
    type EditorCrashReport,
} from '@/utils/editorCrashReport';
import {APP_VERSION} from '@/version';
import {ROOT_COMMAND_SCOPE_ID} from '@/utils/commandScopeStore';
import {CommandPaletteScopeBridge} from '@/components/layout/CommandPaletteScopeBridge';
import {CrashAiAnalysis} from '@/components/ui/CrashAiAnalysis';

interface InnerProps {
    t: TFunction;
    onBackToConnections: () => void;
    onCloseActiveTab: (() => void) | null;
    mode: CrashReportMode;
    openExternalUrl: (url: string) => Promise<void>;
    children: ReactNode;
}

const secondaryButtonClass =
    'inline-flex items-center gap-1.5 px-3 py-1.5 bg-base hover:bg-elevated border border-default text-primary rounded-md text-sm font-medium transition-colors';

interface CrashReportActionsProps {
    t: TFunction;
    report: EditorCrashReport;
    openExternalUrl: (url: string) => Promise<void>;
}

function CrashReportActions({t, report, openExternalUrl}: CrashReportActionsProps) {
    const {copied, copy} = useCopyFeedback();
    const [copyFailed, setCopyFailed] = useState(false);

    const copyReport = async () => {
        setCopyFailed(!(await copy(formatEditorCrashReport(report))));
    };

    return (
        <>
            <button type="button" onClick={copyReport} className={secondaryButtonClass}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied
                    ? t('editor.errorBoundary.reportCopied')
                    : t('editor.errorBoundary.copyReport')}
            </button>
            <button
                type="button"
                onClick={() => void openExternalUrl(buildEditorCrashIssueUrl(report))}
                className={secondaryButtonClass}
            >
                <Bug size={14} />
                {t('editor.errorBoundary.createIssue')}
            </button>
            <CrashAiAnalysis t={t} report={report} buttonClassName={secondaryButtonClass} />
            {copyFailed && (
                <p role="status" className="basis-full text-xs text-accent-error">
                    {t('editor.errorBoundary.copyFailed')}
                </p>
            )}
        </>
    );
}

interface InnerState {
    error: Error | null;
    componentStack: string | null;
}

// Inner class component that catches render errors. Kept private so the
// public surface is the hook-aware wrapper below.
class EditorErrorBoundaryInner extends Component<InnerProps, InnerState> {
    state: InnerState = {error: null, componentStack: null};

    static getDerivedStateFromError(error: Error): Partial<InnerState> {
        return {error};
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        this.setState({componentStack: info.componentStack ?? null});
        console.error(
            '[Editor] render crash caught by error boundary:',
            error,
            info.componentStack,
        );
    }

    reset = () => {
        this.setState({error: null, componentStack: null});
    };

    closeActiveTabAndReset = () => {
        this.props.onCloseActiveTab?.();
        this.reset();
    };

    render() {
        const {error, componentStack} = this.state;
        if (!error) {
            return this.props.children;
        }

        const {t, onBackToConnections, onCloseActiveTab, mode, openExternalUrl} = this.props;
        const details = [error.stack, componentStack].filter(Boolean).join('\n\n');
        const report: EditorCrashReport = {
            message: error.message || error.name,
            stack: error.stack ?? null,
            componentStack,
            appVersion: APP_VERSION,
            platform: navigator.platform,
            mode,
        };

        return (
            <>
                <CommandPaletteScopeBridge scopeId={ROOT_COMMAND_SCOPE_ID} />
                <div
                    role="alert"
                    className="flex h-full w-full items-center justify-center bg-base p-8 overflow-auto"
                >
                    <div className="w-full max-w-xl bg-elevated border border-strong rounded-xl shadow-lg p-6">
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-accent-error/15 rounded-lg shrink-0">
                                <AlertTriangle size={24} className="text-accent-error" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h2 className="text-lg font-semibold text-primary">
                                    {t('editor.errorBoundary.title')}
                                </h2>
                                <p className="mt-1 text-sm text-secondary">
                                    {t('editor.errorBoundary.description')}
                                </p>

                                <div className="mt-3 rounded-md border border-accent-error/20 bg-accent-error/5 px-3 py-2">
                                    <p className="text-sm font-mono text-accent-error break-words whitespace-pre-wrap">
                                        {error.message || error.name}
                                    </p>
                                </div>

                                {details && (
                                    <details className="mt-3">
                                        <summary className="cursor-pointer text-xs text-secondary hover:text-primary select-none">
                                            {t('editor.errorBoundary.showDetails')}
                                        </summary>
                                        <pre className="mt-2 max-h-64 overflow-auto rounded bg-base/60 p-2 text-[11px] text-secondary whitespace-pre-wrap">
                                            {details}
                                        </pre>
                                    </details>
                                )}

                                <div className="mt-4 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={this.reset}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-md text-sm font-medium transition-colors"
                                    >
                                        <RotateCcw size={14} />
                                        {t('editor.errorBoundary.retry')}
                                    </button>
                                    {onCloseActiveTab && (
                                        <button
                                            type="button"
                                            onClick={this.closeActiveTabAndReset}
                                            className={secondaryButtonClass}
                                        >
                                            <XCircle size={14} />
                                            {t('editor.errorBoundary.closeCurrentTab')}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={onBackToConnections}
                                        className={secondaryButtonClass}
                                    >
                                        <Home size={14} />
                                        {t('editor.errorBoundary.backToConnections')}
                                    </button>
                                    <CrashReportActions
                                        t={t}
                                        report={report}
                                        openExternalUrl={openExternalUrl}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </>
        );
    }
}

interface EditorErrorBoundaryProps {
    children: ReactNode;
}

export function EditorErrorBoundary({children}: EditorErrorBoundaryProps) {
    const {t} = useTranslation();
    const navigate = useNavigate();
    const {activeTabId, closeTab} = useEditor();
    const platform = usePlatformCapabilities();

    const onCloseActiveTab = activeTabId ? () => closeTab(activeTabId) : null;

    return (
        <EditorErrorBoundaryInner
            t={t}
            onBackToConnections={() => navigate('/connections')}
            onCloseActiveTab={onCloseActiveTab}
            mode={platform.negotiation.environment === 'tauri' ? 'desktop' : 'web'}
            openExternalUrl={(url) => platform.openExternalUrl(url)}
        >
            {children}
        </EditorErrorBoundaryInner>
    );
}
