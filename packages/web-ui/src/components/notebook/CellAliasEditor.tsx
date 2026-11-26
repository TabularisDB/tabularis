import {useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {Braces} from 'lucide-react';
import {aliasReference, MAX_CELL_ALIAS_LENGTH, type AliasChangeCheck} from '@/utils/notebookAlias';

interface CellAliasEditorProps {
    alias?: string;
    /** Applies the alias when it is allowed; returns why it was not otherwise. */
    onCommit: (alias: string) => AliasChangeCheck;
}

const FOCUS_RING =
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function CellAliasEditor({alias, onCommit}: CellAliasEditorProps) {
    const {t} = useTranslation();
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    // The message floats above the notebook: the cell clips its own overflow.
    const [errorPosition, setErrorPosition] = useState({top: 0, left: 0});
    const inputRef = useRef<HTMLInputElement>(null);
    const errorId = useId();

    const placeError = () => {
        const rect = inputRef.current?.getBoundingClientRect();
        if (rect) setErrorPosition({top: rect.bottom + 4, left: rect.left});
    };

    useEffect(() => {
        if (!error) return;
        const handle = () => {
            const rect = inputRef.current?.getBoundingClientRect();
            if (rect) setErrorPosition({top: rect.bottom + 4, left: rect.left});
        };
        window.addEventListener('scroll', handle, true);
        window.addEventListener('resize', handle);
        return () => {
            window.removeEventListener('scroll', handle, true);
            window.removeEventListener('resize', handle);
        };
    }, [error]);
    const help = t('editor.notebook.alias.help', {
        reference: aliasReference(alias || t('editor.notebook.alias.placeholder')),
    });

    const describe = (check: AliasChangeCheck): string | null => {
        if (check.ok) return null;
        if (check.issue === 'inUse') {
            const places = [
                ...check.usage.cellIndices.map((i) =>
                    t('editor.notebook.alias.usageCell', {n: i + 1}),
                ),
                ...check.usage.params.map((name) => t('editor.notebook.alias.usageParam', {name})),
            ].join(', ');
            return t('editor.notebook.alias.issues.inUse', {
                reference: aliasReference(alias ?? ''),
                places,
            });
        }
        return t(`editor.notebook.alias.issues.${check.issue}`, {
            n: (check.conflictIndex ?? 0) + 1,
            max: MAX_CELL_ALIAS_LENGTH,
        });
    };

    const commit = () => {
        const message = describe(onCommit(draft));
        if (message) placeError();
        setError(message);
        if (!message) setIsEditing(false);
    };

    const cancel = () => {
        setError(null);
        setIsEditing(false);
    };

    if (!isEditing) {
        return (
            <button
                type="button"
                onClick={() => {
                    setDraft(alias ?? '');
                    setIsEditing(true);
                }}
                className={`flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5 transition-colors ${FOCUS_RING} ${
                    alias
                        ? 'font-mono text-accent bg-accent-primary/10 hover:bg-accent-primary/15'
                        : 'text-muted hover:text-secondary'
                }`}
                title={help}
                aria-label={
                    alias
                        ? t('editor.notebook.alias.editLabel', {alias})
                        : t('editor.notebook.alias.add')
                }
            >
                {alias ? aliasReference(alias) : <Braces size={10} />}
            </button>
        );
    }

    return (
        <span className="relative">
            <input
                ref={inputRef}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                type="text"
                value={draft}
                onChange={(e) => {
                    setDraft(e.target.value);
                    setError(null);
                }}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') {
                        e.stopPropagation();
                        cancel();
                    }
                }}
                aria-label={t('editor.notebook.alias.label')}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                title={help}
                className={`text-[10px] font-mono text-secondary bg-base border rounded px-1 py-0.5 outline-none w-28 ${
                    error ? 'border-accent-error/60' : 'border-strong focus:border-focus'
                }`}
                placeholder={t('editor.notebook.alias.placeholder')}
                autoFocus
            />
            {error &&
                createPortal(
                    <span
                        id={errorId}
                        role="alert"
                        className="fixed z-[200] w-64 text-[11px] leading-snug text-accent-error bg-elevated border border-strong rounded px-2 py-1 shadow-lg"
                        style={errorPosition}
                    >
                        {error}
                    </span>,
                    document.body,
                )}
        </span>
    );
}
