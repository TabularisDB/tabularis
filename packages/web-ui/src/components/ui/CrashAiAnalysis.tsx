import {useState} from 'react';
import type {TFunction} from 'i18next';
import {useTranslation} from 'react-i18next';
import {Loader2, Sparkles} from 'lucide-react';
import Markdown, {type Components} from 'react-markdown';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {useSettings} from '@/hooks/useSettings';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {getAiExplanationLanguage} from '@/i18n/language';
import {formatEditorCrashReport, type EditorCrashReport} from '@/utils/editorCrashReport';

type AnalysisState =
    | {status: 'idle'}
    | {status: 'loading'}
    | {status: 'success'; text: string}
    | {status: 'error'; message: string};

const SAFE_URL_PROTOCOL = /^(https?|mailto):/i;

function safeUrl(url: string): string {
    return SAFE_URL_PROTOCOL.test(url.trim()) ? url : '';
}

function AnalysisMarkdown({text}: {text: string}) {
    const platform = usePlatformCapabilities();
    const components: Components = {
        p: ({children}) => <p className="my-1.5 whitespace-pre-line">{children}</p>,
        h1: ({children}) => (
            <h4 className="mt-3 mb-1 text-sm font-semibold text-primary">{children}</h4>
        ),
        h2: ({children}) => (
            <h4 className="mt-3 mb-1 text-sm font-semibold text-primary">{children}</h4>
        ),
        h3: ({children}) => (
            <h4 className="mt-3 mb-1 text-sm font-semibold text-primary">{children}</h4>
        ),
        h4: ({children}) => (
            <h4 className="mt-3 mb-1 text-sm font-semibold text-primary">{children}</h4>
        ),
        h5: ({children}) => (
            <h4 className="mt-3 mb-1 text-sm font-semibold text-primary">{children}</h4>
        ),
        h6: ({children}) => (
            <h4 className="mt-3 mb-1 text-sm font-semibold text-primary">{children}</h4>
        ),
        ul: ({children}) => <ul className="my-1.5 list-disc pl-5 space-y-1">{children}</ul>,
        ol: ({children}) => <ol className="my-1.5 list-decimal pl-5 space-y-1">{children}</ol>,
        strong: ({children}) => <strong className="font-semibold text-primary">{children}</strong>,
        em: ({children}) => <em className="italic">{children}</em>,
        pre: ({children}) => (
            <pre className="my-2 overflow-x-auto rounded bg-elevated px-3 py-2 font-mono text-xs text-primary whitespace-pre">
                {children}
            </pre>
        ),
        code: ({className, children}) =>
            className ? (
                <code className={className}>{children}</code>
            ) : (
                <code className="px-1 py-0.5 rounded bg-elevated text-primary font-mono text-xs">
                    {children}
                </code>
            ),
        a: ({href, children}) =>
            href ? (
                <a
                    href={href}
                    onClick={(e) => {
                        e.preventDefault();
                        void platform.openExternalUrl(href);
                    }}
                    className="text-accent underline underline-offset-2 cursor-pointer"
                >
                    {children}
                </a>
            ) : (
                <span>{children}</span>
            ),
    };

    return (
        <Markdown urlTransform={safeUrl} components={components}>
            {text}
        </Markdown>
    );
}

interface CrashAiAnalysisProps {
    t: TFunction;
    report: EditorCrashReport;
    buttonClassName: string;
}

export function CrashAiAnalysis({t, report, buttonClassName}: CrashAiAnalysisProps) {
    const {i18n} = useTranslation();
    const {settings} = useSettings();
    const client = useTabularisClient();
    const [state, setState] = useState<AnalysisState>({status: 'idle'});

    const provider = settings.aiEnabled ? settings.aiProvider : null;
    if (!provider) return null;

    const analyze = async () => {
        setState({status: 'loading'});
        try {
            const text = await client.call('analyze_ai_crash_report', {
                req: {
                    provider,
                    model: settings.aiModel || '',
                    query: formatEditorCrashReport(report),
                    language: getAiExplanationLanguage(
                        settings.language,
                        i18n.resolvedLanguage ?? i18n.language,
                    ),
                },
            });
            setState({status: 'success', text});
        } catch (error) {
            setState({status: 'error', message: String(error)});
        }
    };

    const loading = state.status === 'loading';

    return (
        <>
            <button
                type="button"
                onClick={analyze}
                disabled={loading}
                className={`${buttonClassName} disabled:opacity-60 disabled:cursor-wait`}
            >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {loading
                    ? t('editor.errorBoundary.aiAnalyzing')
                    : t('editor.errorBoundary.analyzeWithAi')}
            </button>
            <div role="status" className="basis-full empty:hidden">
                {state.status === 'success' && (
                    <div className="mt-2 rounded-md border border-default bg-base/60 px-3 py-2">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-accent-secondary">
                            <Sparkles size={12} />
                            {t('editor.errorBoundary.aiAnalysisTitle')}
                        </p>
                        <div className="mt-1 max-h-64 overflow-auto text-sm text-secondary break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                            <AnalysisMarkdown text={state.text} />
                        </div>
                    </div>
                )}
                {state.status === 'error' && (
                    <div className="mt-2 text-xs text-accent-error">
                        <p>{t('editor.errorBoundary.aiAnalysisFailed')}</p>
                        <p className="mt-0.5 font-mono break-words">{state.message}</p>
                    </div>
                )}
            </div>
        </>
    );
}
