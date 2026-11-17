import {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';
import Markdown from 'react-markdown';
import {useTranslation} from 'react-i18next';
import {HelpCircle} from 'lucide-react';
import type {NotebookCell} from '@/types/notebook';
import {
    buildScalarSuggestions,
    type ScalarResolution,
    type ScalarSuggestion,
} from '@/utils/notebookScalarReferences';
import {remarkScalarReferences} from '@/utils/remarkScalarReferences';

interface MarkdownCellProps {
    cell: NotebookCell;
    cells?: NotebookCell[];
    onContentChange: (content: string) => void;
    onTogglePreview: () => void;
}

const TRIGGER_PATTERN = /\{\{(?:value:([^\n}]*)|v(?:a(?:l(?:u(?:e)?)?)?)?)?$/;

function MarkdownPreview({content, cells}: {content: string; cells: NotebookCell[]}) {
    const {t} = useTranslation();

    const localizeTarget = useCallback(
        (label: string): string => {
            const match = /^Cell (\d+)$/.exec(label);
            return match
                ? t('editor.notebook.scalarRef.cellLabel', {number: Number(match[1])})
                : label;
        },
        [t],
    );

    const formatPlaceholder = useCallback(
        (resolution: ScalarResolution): string => {
            switch (resolution.kind) {
                case 'value':
                    return resolution.text;
                case 'null':
                    return 'NULL';
                case 'notRun':
                    return t('editor.notebook.scalarRef.notRun', {
                        target: localizeTarget(resolution.targetLabel),
                    });
                case 'loading':
                    return t('editor.notebook.scalarRef.loading', {
                        target: localizeTarget(resolution.targetLabel),
                    });
                case 'error':
                    return t('editor.notebook.scalarRef.error', {
                        target: localizeTarget(resolution.targetLabel),
                    });
                case 'noRows':
                    return t('editor.notebook.scalarRef.noRows', {
                        target: localizeTarget(resolution.targetLabel),
                    });
                case 'multipleRows':
                    return t('editor.notebook.scalarRef.multipleRows', {
                        target: localizeTarget(resolution.targetLabel),
                        count: resolution.rowCount,
                    });
                case 'missingColumn':
                    return t('editor.notebook.scalarRef.missingColumn', {
                        target: localizeTarget(resolution.targetLabel),
                        column: resolution.column,
                    });
                case 'ambiguousColumn':
                    return t('editor.notebook.scalarRef.ambiguousColumn', {
                        target: localizeTarget(resolution.targetLabel),
                        column: resolution.column,
                    });
                case 'missingCell':
                    return t('editor.notebook.scalarRef.missingCell', {
                        target: localizeTarget(resolution.targetLabel),
                    });
                case 'ambiguousCell':
                    return t('editor.notebook.scalarRef.ambiguousCell', {
                        target: localizeTarget(resolution.targetLabel),
                    });
                case 'notSqlCell':
                    return t('editor.notebook.scalarRef.notSqlCell', {
                        target: localizeTarget(resolution.targetLabel),
                    });
                case 'invalid':
                    return t('editor.notebook.scalarRef.invalid', {raw: resolution.raw});
            }
        },
        [localizeTarget, t],
    );

    const remarkPlugins = useMemo(
        () => [
            () =>
                remarkScalarReferences({
                    cells,
                    formatPlaceholder,
                    outdatedLabel: t('editor.notebook.scalarRef.outdatedTooltip'),
                    outdatedShort: t('editor.notebook.scalarRef.outdatedShort'),
                }),
        ],
        [cells, formatPlaceholder, t],
    );

    return (
        <div
            className={
                'prose-notebook text-sm text-secondary px-4 py-3 min-h-[60px] ' +
                '[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:text-primary ' +
                '[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:text-primary ' +
                '[&_h3]:text-base [&_h3]:font-medium [&_h3]:mb-1 [&_h3]:text-primary ' +
                '[&_p]:mb-2 [&_p]:leading-relaxed ' +
                '[&_code]:bg-surface-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono ' +
                '[&_pre]:bg-surface-secondary [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:mb-2 ' +
                '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 ' +
                '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 ' +
                '[&_li]:mb-1 ' +
                '[&_a]:text-accent [&_a]:underline ' +
                '[&_blockquote]:border-l-2 [&_blockquote]:border-muted [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted ' +
                '[&_hr]:border-default [&_hr]:my-4 ' +
                '[&_table]:border-collapse [&_table]:w-full [&_table]:mb-2 ' +
                '[&_th]:border [&_th]:border-default [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold ' +
                '[&_td]:border [&_td]:border-default [&_td]:px-2 [&_td]:py-1 [&_td]:text-xs ' +
                '[&_strong]:font-semibold [&_strong]:text-primary ' +
                '[&_em]:italic'
            }
        >
            <Markdown remarkPlugins={remarkPlugins}>{content}</Markdown>
        </div>
    );
}

interface CompletionTrigger {
    start: number;
    end: number;
    query: string;
}

function MarkdownEditor({
    content,
    cells,
    onContentChange,
    placeholder,
}: {
    content: string;
    cells: NotebookCell[];
    onContentChange: (content: string) => void;
    placeholder: string;
}) {
    const {t} = useTranslation();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [trigger, setTrigger] = useState<CompletionTrigger | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [showHelp, setShowHelp] = useState(false);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.max(80, textarea.scrollHeight)}px`;
        }
    }, [content]);

    const allSuggestions = useMemo(() => buildScalarSuggestions(cells), [cells]);

    const filteredSuggestions = useMemo(() => {
        if (!trigger) return [];
        const q = trigger.query.toLowerCase();
        if (!q) return allSuggestions;
        return allSuggestions.filter(
            (s) =>
                s.label.toLowerCase().includes(q) ||
                (s.cellName?.toLowerCase().includes(q) ?? false),
        );
    }, [allSuggestions, trigger]);

    const clampedSelectedIndex =
        filteredSuggestions.length > 0
            ? Math.min(selectedIndex, filteredSuggestions.length - 1)
            : 0;

    const updateTriggerFromCursor = useCallback((value: string, cursorPos: number | null) => {
        if (cursorPos == null) {
            setTrigger(null);
            return;
        }
        const before = value.slice(0, cursorPos);
        const match = TRIGGER_PATTERN.exec(before);
        if (!match) {
            setTrigger(null);
            return;
        }
        setTrigger({
            start: match.index,
            end: cursorPos,
            query: match[1] ?? '',
        });
        setSelectedIndex(0);
    }, []);

    const applySuggestion = useCallback(
        (suggestion: ScalarSuggestion) => {
            if (!trigger) return;
            const nextValue =
                content.slice(0, trigger.start) +
                suggestion.insertText +
                content.slice(trigger.end);
            const nextCursor = trigger.start + suggestion.insertText.length;
            onContentChange(nextValue);
            setTrigger(null);
            requestAnimationFrame(() => {
                const textarea = textareaRef.current;
                if (textarea) {
                    textarea.focus();
                    textarea.setSelectionRange(nextCursor, nextCursor);
                }
            });
        },
        [content, onContentChange, trigger],
    );

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (!trigger || filteredSuggestions.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex((prev) => (prev + 1) % filteredSuggestions.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(
                (prev) => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length,
            );
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            applySuggestion(filteredSuggestions[clampedSelectedIndex]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setTrigger(null);
        }
    };

    const listboxId = useId();
    const isSuggestionsOpen = Boolean(trigger && filteredSuggestions.length > 0);
    const activeOptionId = isSuggestionsOpen
        ? `${listboxId}-option-${clampedSelectedIndex}`
        : undefined;

    return (
        <div className="relative">
            {/* Prose field: natural-language input, so spellcheck/autocorrect stay ON; only the WebKit autofill pill is disabled. */}
            <textarea
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={isSuggestionsOpen}
                aria-controls={isSuggestionsOpen ? listboxId : undefined}
                aria-activedescendant={activeOptionId}
                autoComplete="off"
                spellCheck={true}
                ref={textareaRef}
                value={content}
                onChange={(e) => {
                    const nextValue = e.target.value;
                    onContentChange(nextValue);
                    updateTriggerFromCursor(nextValue, e.target.selectionStart);
                }}
                onKeyDown={handleKeyDown}
                onBlur={() => setTrigger(null)}
                placeholder={placeholder}
                className="w-full bg-base text-sm text-primary font-mono p-3 resize-none outline-none border-none min-h-[80px] block"
            />

            {isSuggestionsOpen && (
                <div
                    id={listboxId}
                    role="listbox"
                    aria-label={t('editor.notebook.scalarRef.suggestionsLabel')}
                    className="mx-3 mb-2 max-h-48 overflow-y-auto bg-elevated border border-strong rounded-md shadow-lg py-1 z-20"
                >
                    {filteredSuggestions.map((item, idx) => {
                        const isSelected = idx === clampedSelectedIndex;
                        const cellMatch = item.cellName ? /^Cell (\d+)$/.exec(item.cellName) : null;
                        const displayCellName = cellMatch
                            ? t('editor.notebook.scalarRef.cellLabel', {
                                  number: Number(cellMatch[1]),
                              })
                            : item.cellName;
                        return (
                            <button
                                key={`${item.label}-${idx}`}
                                id={`${listboxId}-option-${idx}`}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    applySuggestion(item);
                                }}
                                className={`w-full px-2.5 py-1.5 text-left flex items-center justify-between gap-2 text-xs transition-colors ${
                                    isSelected
                                        ? 'bg-surface-secondary text-primary'
                                        : 'text-secondary hover:bg-surface-secondary'
                                }`}
                            >
                                <span className="font-mono truncate">{item.label}</span>
                                <span className="flex items-center gap-2 shrink-0 text-[11px] text-muted">
                                    {displayCellName && (
                                        <span className="truncate max-w-[140px]">
                                            {displayCellName}
                                        </span>
                                    )}
                                    {item.preview !== undefined && (
                                        <span className="font-mono bg-base px-1.5 py-0.5 rounded border border-default text-secondary">
                                            {item.preview}
                                        </span>
                                    )}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="border-t border-default bg-elevated px-3 py-1 flex items-center justify-between gap-2 text-[11px] text-muted">
                <span className="truncate">{t('editor.notebook.scalarRef.syntaxHint')}</span>
                <button
                    type="button"
                    onClick={() => setShowHelp((prev) => !prev)}
                    aria-expanded={showHelp}
                    aria-label={t('editor.notebook.scalarRef.helpToggle')}
                    className="inline-flex items-center gap-1 text-muted hover:text-primary rounded px-1 py-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus shrink-0"
                >
                    <HelpCircle size={12} />
                    <span>{t('editor.notebook.scalarRef.helpLabel')}</span>
                </button>
            </div>

            {showHelp && (
                <div className="border-t border-default bg-surface-secondary px-3 py-2 text-xs text-secondary space-y-1">
                    <p>{t('editor.notebook.scalarRef.helpDescription')}</p>
                    <p className="font-mono text-[11px] text-primary">
                        {t('editor.notebook.scalarRef.helpExample')}
                    </p>
                </div>
            )}
        </div>
    );
}

export function MarkdownCell({
    cell,
    cells = [],
    onContentChange,
    onTogglePreview,
}: MarkdownCellProps) {
    const {t} = useTranslation();

    if (cell.isPreview) {
        if (!cell.content.trim()) {
            return (
                <div
                    className="px-4 py-3 text-sm text-muted italic cursor-pointer min-h-[60px] flex items-center"
                    onDoubleClick={onTogglePreview}
                >
                    {t('editor.notebook.markdownPlaceholder')}
                </div>
            );
        }

        return (
            <div onDoubleClick={onTogglePreview} className="cursor-pointer">
                <MarkdownPreview content={cell.content} cells={cells} />
            </div>
        );
    }

    return (
        <MarkdownEditor
            content={cell.content}
            cells={cells}
            onContentChange={onContentChange}
            placeholder={t('editor.notebook.markdownPlaceholder')}
        />
    );
}
