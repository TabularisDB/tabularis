import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Check, Copy} from 'lucide-react';
import clsx from 'clsx';
import type {ExplainNode} from '../types';
import type {ExplainNodeMetrics} from '../metrics';
import type {ExplainDiagnostic} from '../diagnostics';
import {ExplainDiagnosticList} from './ExplainDiagnosticChips';
import {
    formatExplainNodeDetails,
    getExplainNodeDetailSections,
    type ExplainNodeDetailEntry,
} from '../nodeDetails';

export interface ExplainNodeDetailsProps {
    node: ExplainNode | null;
    hasAnalyzeData: boolean;
    /** Derived exclusive metrics for `node`, when the caller has them. */
    metrics?: ExplainNodeMetrics | null;
    diagnostics?: ExplainDiagnostic[];
    onCopyDetails?: (text: string) => Promise<boolean | void> | boolean | void;
    className?: string;
}

export function ExplainNodeDetails({
    node,
    hasAnalyzeData,
    metrics = null,
    diagnostics = [],
    onCopyDetails,
    className,
}: ExplainNodeDetailsProps) {
    const {t} = useTranslation();
    const translate = useCallback(
        (key: string, fallback?: string): string => {
            return (
                (t(key, fallback ? {defaultValue: fallback} : undefined) as unknown as string) ||
                fallback ||
                key
            );
        },
        [t],
    );
    const [copied, setCopied] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        setCopied(false);
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }
    }, [node?.id]);

    const handleCopy = useCallback(async () => {
        if (!node || isCopying) return;
        const text = formatExplainNodeDetails(node, {
            hasAnalyzeData,
            metrics,
            diagnostics,
            t: translate,
        });

        setIsCopying(true);
        try {
            let success = false;
            if (onCopyDetails) {
                const result = await onCopyDetails(text);
                if (result !== false) {
                    success = true;
                }
            } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                success = true;
            }

            if (success) {
                if (timerRef.current) {
                    clearTimeout(timerRef.current);
                }
                setCopied(true);
                timerRef.current = setTimeout(() => {
                    setCopied(false);
                }, 2000);
            }
        } catch (err) {
            console.error('Failed to copy node details:', err);
        } finally {
            setIsCopying(false);
        }
    }, [node, isCopying, hasAnalyzeData, metrics, diagnostics, translate, onCopyDetails]);

    const sections = node
        ? getExplainNodeDetailSections(node, {
              hasAnalyzeData,
              metrics,
              diagnostics,
              t: translate,
          })
        : [];

    return (
        <div className={clsx('text-xs flex flex-col', className)}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-default/60 bg-base/60 sticky top-0 z-10">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {t('editor.visualExplain.nodeDetails', 'Node Details')}
                </span>
                <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!node || isCopying}
                    className="flex items-center gap-1.5 px-2 py-0.5 text-xs rounded border border-default bg-surface hover:bg-surface-secondary text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                    title={
                        node
                            ? t('editor.visualExplain.copyDetails', 'Copy Details')
                            : t('editor.visualExplain.selectNode', 'Select a node to view details')
                    }
                    aria-label={t('editor.visualExplain.copyDetails', 'Copy Details')}
                >
                    {copied ? (
                        <>
                            <Check size={12} className="text-accent-success" />
                            <span className="text-accent-success text-[11px]">
                                {t('editor.visualExplain.copied', 'Copied')}
                            </span>
                        </>
                    ) : (
                        <>
                            <Copy size={12} className="text-secondary" />
                            <span className="text-secondary text-[11px]">
                                {t('editor.visualExplain.copyDetails', 'Copy Details')}
                            </span>
                        </>
                    )}
                </button>
            </div>

            {!node ? (
                <div className="p-4 text-xs text-muted">
                    {t('editor.visualExplain.selectNode', 'Select a node to view details')}
                </div>
            ) : (
                <div>
                    {diagnostics.length > 0 && (
                        <div className="border-b border-default/60">
                            <div className="bg-base/60 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                                {t('editor.visualExplain.diagnostics.title', 'Diagnostics')}
                            </div>
                            <ExplainDiagnosticList diagnostics={diagnostics} />
                        </div>
                    )}
                    {sections.map((section) => (
                        <DetailSection
                            key={section.title}
                            title={section.title}
                            entries={section.entries}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface DetailSectionProps {
    title: string;
    entries: ExplainNodeDetailEntry[];
}

function DetailSection({title, entries}: DetailSectionProps) {
    if (entries.length === 0) {
        return null;
    }

    return (
        <div className="border-b border-default/60 last:border-b-0">
            <div className="px-4 py-3 text-[11px] uppercase tracking-wide text-muted font-semibold bg-base/60">
                {title}
            </div>
            <div className="divide-y divide-default/40">
                {entries.map(({label, value}) => (
                    <div key={label} className="px-4 py-2.5">
                        <div className="text-[11px] text-muted mb-1">{label}</div>
                        <div className="text-secondary break-words font-mono leading-relaxed">
                            {value}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
