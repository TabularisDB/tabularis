import {useState, useCallback, useEffect, useRef} from 'react';
import type {BeforeMount} from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import {MonacoEditor} from '@/components/ui/LazyMonaco';
import {Select} from '@/components/ui/Select';
import {useEditorTheme} from '@/hooks/useEditorTheme';
import {loadMonacoTheme} from '@/themes/themeUtils';
import {getMonacoThemeId} from '@/themes/themeRuntime';
import {useTranslation} from 'react-i18next';
import {
    loadSqlSnippets,
    upsertSqlSnippet,
    deleteSqlSnippet,
    validateSnippetPrefix,
    validateSnippetBody,
    type SqlSnippet,
    type SqlDialectScope,
} from '@/utils/sqlSnippets';
import {Plus, Trash2, Edit2, Code2, AlertCircle, Check} from 'lucide-react';
import clsx from 'clsx';

export function SnippetsTab() {
    const {t} = useTranslation();
    const editorTheme = useEditorTheme();
    const monacoRef = useRef<typeof Monaco | null>(null);

    useEffect(() => {
        if (monacoRef.current) loadMonacoTheme(editorTheme, monacoRef.current);
    }, [editorTheme]);

    const beforeMount: BeforeMount = (monaco) => {
        monacoRef.current = monaco;
        loadMonacoTheme(editorTheme, monaco);
    };
    const [snippets, setSnippets] = useState<SqlSnippet[]>(() => loadSqlSnippets());
    const [editingSnippet, setEditingSnippet] = useState<SqlSnippet | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    // Form fields
    const [name, setName] = useState('');
    const [prefix, setPrefix] = useState('');
    const [body, setBody] = useState('');
    const [description, setDescription] = useState('');
    const [dialect, setDialect] = useState<SqlDialectScope>('all');
    const [formError, setFormError] = useState<string | null>(null);

    const refresh = useCallback(() => {
        setSnippets(loadSqlSnippets());
    }, []);

    const handleStartCreate = () => {
        setEditingSnippet(null);
        setName('');
        setPrefix('');
        setBody('');
        setDescription('');
        setDialect('all');
        setFormError(null);
        setIsCreating(true);
    };

    const handleStartEdit = (snippet: SqlSnippet) => {
        setIsCreating(false);
        setEditingSnippet(snippet);
        setName(snippet.name);
        setPrefix(snippet.prefix);
        setBody(snippet.body);
        setDescription(snippet.description || '');
        setDialect(snippet.dialect || 'all');
        setFormError(null);
    };

    const handleCancel = () => {
        setIsCreating(false);
        setEditingSnippet(null);
        setFormError(null);
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedPrefix = prefix.trim();
        const prefixValidation = validateSnippetPrefix(trimmedPrefix);
        if (!prefixValidation.valid) {
            setFormError(
                t(
                    'settings.snippets.invalidPrefix',
                    'Prefix must contain only letters, numbers, underscores, and hyphens',
                ),
            );
            return;
        }

        const bodyValidation = validateSnippetBody(body);
        if (!bodyValidation.valid) {
            setFormError(t('settings.snippets.invalidBody', 'Snippet body cannot be empty'));
            return;
        }

        // Check for duplicate prefix collision within the same dialect scope (excluding current snippet if editing)
        const duplicate = snippets.some(
            (s) =>
                s.id !== editingSnippet?.id &&
                s.prefix.toLowerCase() === trimmedPrefix.toLowerCase() &&
                (s.dialect === dialect || s.dialect === 'all' || dialect === 'all'),
        );
        if (duplicate) {
            setFormError(
                t(
                    'settings.snippets.duplicatePrefix',
                    'A snippet with this prefix already exists for this dialect scope',
                ),
            );
            return;
        }

        upsertSqlSnippet({
            id: editingSnippet?.id,
            name: name.trim() || trimmedPrefix,
            prefix: trimmedPrefix,
            body,
            description: description.trim() || undefined,
            dialect,
        });

        setIsCreating(false);
        setEditingSnippet(null);
        setFormError(null);
        refresh();
    };

    const handleDelete = (id: string) => {
        deleteSqlSnippet(id);
        if (editingSnippet?.id === id) {
            handleCancel();
        }
        refresh();
    };

    return (
        <div className="flex flex-col gap-6 max-w-4xl">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-base font-semibold text-primary">
                        {t('settings.snippets.title', 'SQL Snippets')}
                    </h2>
                    <p className="text-xs text-muted mt-1">
                        {t(
                            'settings.snippets.subtitle',
                            'Define reusable SQL templates with trigger prefixes and ${1:tab-stop} placeholders for Monaco autocomplete.',
                        )}
                    </p>
                </div>
                {!isCreating && !editingSnippet && (
                    <button
                        type="button"
                        onClick={handleStartCreate}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-inverse font-medium text-xs transition-colors shadow-sm"
                    >
                        <Plus size={14} />
                        {t('settings.snippets.add', 'New Snippet')}
                    </button>
                )}
            </div>

            {/* Create / Edit Form */}
            {(isCreating || editingSnippet) && (
                <form
                    onSubmit={handleSave}
                    className="flex flex-col gap-4 p-4 rounded-xl border border-default bg-elevated/60 shadow-sm"
                >
                    <div className="flex items-center justify-between pb-2 border-b border-default text-xs font-semibold text-primary">
                        <span>
                            {isCreating
                                ? t('settings.snippets.createTitle', 'Create Snippet')
                                : t('settings.snippets.editTitle', 'Edit Snippet')}
                        </span>
                    </div>

                    {formError && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-error/15 border border-accent-error/30 text-accent-error text-xs">
                            <AlertCircle size={14} className="shrink-0" />
                            <span>{formError}</span>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label
                                htmlFor="snippet-name-input"
                                className="block text-xs font-medium text-primary mb-1"
                            >
                                {t('settings.snippets.nameLabel', 'Snippet Name')}
                            </label>
                            <input
                                id="snippet-name-input"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t(
                                    'settings.snippets.namePlaceholder',
                                    'e.g. Select Active Orders',
                                )}
                                className="w-full px-3 py-1.5 rounded-lg bg-base border border-default text-primary placeholder:text-muted focus:outline-none focus:border-focus text-xs"
                            />
                        </div>

                        <div>
                            <label
                                htmlFor="snippet-prefix-input"
                                className="block text-xs font-medium text-primary mb-1"
                            >
                                {t('settings.snippets.prefixLabel', 'Trigger Prefix')}{' '}
                                <span className="text-accent-error">*</span>
                            </label>
                            <input
                                id="snippet-prefix-input"
                                type="text"
                                value={prefix}
                                onChange={(e) => setPrefix(e.target.value)}
                                placeholder={t(
                                    'settings.snippets.prefixPlaceholder',
                                    'e.g. selorders',
                                )}
                                className="w-full px-3 py-1.5 rounded-lg bg-base border border-default text-primary placeholder:text-muted focus:outline-none focus:border-focus text-xs font-mono"
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label
                                htmlFor="snippet-dialect-select"
                                className="block text-xs font-medium text-primary mb-1"
                            >
                                {t('settings.snippets.dialectLabel', 'Dialect Scope')}
                            </label>
                            <Select
                                id="snippet-dialect-select"
                                ariaLabel={t('settings.snippets.dialectLabel', 'Dialect Scope')}
                                value={dialect}
                                options={['all', 'postgres', 'mysql', 'sqlite']}
                                labels={{
                                    all: t('settings.snippets.allDialects', 'All Dialects'),
                                    postgres: 'PostgreSQL',
                                    mysql: 'MySQL / MariaDB',
                                    sqlite: 'SQLite',
                                }}
                                onChange={(value) => setDialect(value as SqlDialectScope)}
                                searchable={false}
                            />
                        </div>

                        <div>
                            <label
                                htmlFor="snippet-description-input"
                                className="block text-xs font-medium text-primary mb-1"
                            >
                                {t('settings.snippets.descriptionLabel', 'Description')}
                            </label>
                            <input
                                id="snippet-description-input"
                                type="text"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={t(
                                    'settings.snippets.descPlaceholder',
                                    'e.g. Select orders with pending status',
                                )}
                                className="w-full px-3 py-1.5 rounded-lg bg-base border border-default text-primary placeholder:text-muted focus:outline-none focus:border-focus text-xs"
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label
                                id="snippet-body-label"
                                className="text-xs font-medium text-primary"
                            >
                                {t('settings.snippets.bodyLabel', 'Snippet Body')}{' '}
                                <span className="text-accent-error">*</span>
                            </label>
                            <span className="text-[11px] text-muted">
                                {t(
                                    'settings.snippets.tabStopHint',
                                    'Use ${1:placeholder} for editable tab stops',
                                )}
                            </span>
                        </div>
                        <div className="overflow-hidden rounded-lg border border-default bg-base">
                            <MonacoEditor
                                height="150px"
                                language="sql"
                                value={body}
                                theme={getMonacoThemeId(editorTheme.id)}
                                beforeMount={beforeMount}
                                onChange={(value) => setBody(value ?? '')}
                                options={{
                                    ariaLabel: t('settings.snippets.bodyLabel', 'Snippet Body'),
                                    minimap: {enabled: false},
                                    lineNumbers: 'on',
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                    wordWrap: 'on',
                                    tabSize: 4,
                                }}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-default">
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-secondary text-secondary hover:text-primary border border-default text-xs transition-colors"
                        >
                            {t('common.cancel', 'Cancel')}
                        </button>
                        <button
                            type="submit"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-inverse font-medium text-xs transition-colors shadow-sm"
                        >
                            <Check size={14} />
                            {t('common.save', 'Save')}
                        </button>
                    </div>
                </form>
            )}

            {/* Snippets List */}
            <div className="flex flex-col gap-2.5">
                {snippets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted gap-2 border border-dashed border-default rounded-xl bg-surface/30">
                        <Code2 size={28} className="opacity-40" />
                        <span className="text-xs">
                            {t('settings.snippets.noSnippets', 'No SQL snippets configured yet.')}
                        </span>
                    </div>
                ) : (
                    snippets.map((snippet) => (
                        <div
                            key={snippet.id}
                            className={clsx(
                                'flex items-start justify-between gap-4 p-3.5 rounded-xl border transition-all text-xs bg-base/50',
                                editingSnippet?.id === snippet.id
                                    ? 'border-accent-primary ring-1 ring-accent-primary/50'
                                    : 'border-default hover:border-strong',
                            )}
                        >
                            <div className="flex flex-col min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-primary">
                                        {snippet.name}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded font-mono text-[11px] bg-accent-primary/10 text-accent font-semibold border border-accent/20">
                                        {snippet.prefix}
                                    </span>
                                    {snippet.dialect && snippet.dialect !== 'all' && (
                                        <span className="px-1.5 py-0.5 rounded uppercase font-mono text-[10px] bg-surface-secondary text-secondary border border-default">
                                            {snippet.dialect}
                                        </span>
                                    )}
                                </div>
                                {snippet.description && (
                                    <p className="text-muted text-[11px] mt-1">
                                        {snippet.description}
                                    </p>
                                )}
                                <div className="mt-2 p-2 rounded bg-elevated/70 border border-default/60 font-mono text-[11px] text-primary whitespace-pre-wrap overflow-x-auto max-h-24">
                                    {snippet.body}
                                </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0 pt-0.5">
                                <button
                                    type="button"
                                    onClick={() => handleStartEdit(snippet)}
                                    className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-secondary transition-colors"
                                    title={t('common.edit', 'Edit')}
                                    aria-label={t('common.edit', 'Edit')}
                                >
                                    <Edit2 size={14} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(snippet.id)}
                                    className="p-1.5 rounded-lg text-secondary hover:text-accent-error hover:bg-surface-secondary transition-colors"
                                    title={t('common.delete', 'Delete')}
                                    aria-label={t('common.delete', 'Delete')}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
