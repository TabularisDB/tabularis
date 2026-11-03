import {useState} from 'react';
import type {TFunction} from 'i18next';
import {useTranslation} from 'react-i18next';
import {Loader2, Sparkles} from 'lucide-react';
import {useSettings} from '@/hooks/useSettings';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {getAiExplanationLanguage} from '@/i18n/language';
import {formatEditorCrashReport, type EditorCrashReport} from '@/utils/editorCrashReport';

type AnalysisState =
    | {status: 'idle'}
    | {status: 'loading'}
    | {status: 'success'; text: string}
    | {status: 'error'; message: string};

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
                        <p className="mt-1 max-h-64 overflow-auto text-sm text-secondary whitespace-pre-wrap break-words">
                            {state.text}
                        </p>
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
