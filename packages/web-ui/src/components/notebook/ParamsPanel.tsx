import {useId, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Plus, X, Variable} from 'lucide-react';
import {BooleanInput} from '@/components/ui/BooleanInput';
import {DateInput} from '@/components/ui/DateInput';
import type {NotebookParam} from '@/types/notebook';
import {
    PARAM_TYPES,
    validateParamName,
    createParam,
    addParam,
    updateParam,
    removeParam,
    applyParamDrafts,
    canApplyParamDrafts,
    changeParamType,
    draftFor,
    hasPendingParamDrafts,
    isParamType,
    isValidParamDate,
    normalizeParamOptions,
    validateParam,
    withParamDraft,
    withoutParamDraft,
    type ParamDrafts,
} from '@/utils/notebookParams';
import {CompactSelect} from './CompactSelect';

interface ParamsPanelProps {
    params: NotebookParam[];
    onParamsChange: (params: NotebookParam[]) => void;
    /**
     * Unapplied rows. The notebook owns them so they survive a switch between
     * Edit and Report view; without the pair the panel keeps its own.
     */
    drafts?: ParamDrafts;
    onDraftsChange?: (drafts: ParamDrafts) => void;
    /** The active connection takes typed parameters (`supportsTypedParams`). */
    typedSupported?: boolean;
}

const FIELD_CLASS =
    'text-[11px] bg-surface-secondary border border-strong rounded px-1.5 py-0.5 text-primary font-mono outline-none focus:border-focus disabled:opacity-60';
const CHECK_LABEL_CLASS = 'flex items-center gap-1 text-[10px] text-secondary cursor-pointer';
const CHECKBOX_CLASS =
    'rounded border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const ACTION_CLASS =
    'px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 disabled:cursor-not-allowed';

/** The value control of a row, matched to its type. */
function ParamValueControl({
    row,
    describedBy,
    invalid,
    onValueChange,
}: {
    row: NotebookParam;
    describedBy: string | undefined;
    invalid: boolean;
    onValueChange: (value: string) => void;
}) {
    const {t} = useTranslation();
    const label = t('editor.notebook.params.value');

    if (row.isNull) {
        return (
            <input
                type="text"
                value="NULL"
                aria-label={label}
                disabled
                className={`${FIELD_CLASS} flex-1 min-w-0`}
            />
        );
    }
    if (row.type === 'boolean') {
        return (
            <span className="flex-1 min-w-0 text-[11px] text-primary font-mono">
                <BooleanInput
                    name={label}
                    value={row.value === 'true'}
                    onChange={(value) => onValueChange(value ? 'true' : 'false')}
                />
            </span>
        );
    }
    if (row.type === 'date') {
        return (
            <div role="group" aria-label={label} aria-describedby={describedBy} className="flex-1">
                <DateInput
                    mode="date"
                    // An unreadable value shows as empty, with the control's
                    // own "use this date" action, instead of a made-up date.
                    value={isValidParamDate(row.value) ? row.value : ''}
                    onChange={onValueChange}
                />
            </div>
        );
    }
    if (row.type === 'select') {
        const options = normalizeParamOptions(row.options ?? []);
        return (
            <CompactSelect
                aria-label={label}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                value={row.value}
                onChange={(e) => onValueChange(e.target.value)}
                className="font-mono"
            >
                {!options.includes(row.value) && <option value={row.value}>{row.value}</option>}
                {options.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </CompactSelect>
        );
    }
    return (
        <input
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            type="text"
            inputMode={row.type === 'number' ? 'decimal' : undefined}
            value={row.value}
            aria-label={label}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={(e) => onValueChange(e.target.value)}
            className={`${FIELD_CLASS} flex-1 min-w-0`}
        />
    );
}

function ParamRow({
    param,
    draft,
    typedSupported,
    onDraftChange,
    onRawValueChange,
    onRemove,
}: {
    param: NotebookParam;
    draft: NotebookParam | undefined;
    typedSupported: boolean;
    onDraftChange: (draft: NotebookParam) => void;
    onRawValueChange: (value: string) => void;
    onRemove: () => void;
}) {
    const {t} = useTranslation();
    const messageId = useId();
    const row = draft ?? param;
    const issue = validateParam(row);
    const unsupported = !!row.type && !typedSupported;
    const message = unsupported
        ? t('editor.notebook.params.unsupportedDriver')
        : issue
          ? t(`editor.notebook.params.issues.${issue}`)
          : undefined;

    const changeType = (value: string) => {
        const next = changeParamType(row, isParamType(value) ? value : undefined);
        // A raw parameter set back to raw is live again, like any raw value.
        if (!next.type && !param.type) onRawValueChange(next.value);
        else onDraftChange(next);
    };
    const changeValue = (value: string) => {
        // Only a row with a type, applied or drafted, waits for Apply.
        if (!row.type && !param.type) onRawValueChange(value);
        else onDraftChange({...row, value});
    };

    return (
        <div role="group" aria-label={`@${param.name}`} className="space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-accent-success font-mono shrink-0">
                    @{param.name}
                </span>
                <CompactSelect
                    aria-label={t('editor.notebook.params.type')}
                    value={row.type ?? 'raw'}
                    onChange={(e) => changeType(e.target.value)}
                    disabled={!typedSupported && !row.type}
                >
                    <option value="raw">{t('editor.notebook.params.types.raw')}</option>
                    {PARAM_TYPES.map((type) => (
                        <option
                            key={type}
                            value={type}
                            disabled={!typedSupported && type !== row.type}
                        >
                            {t(`editor.notebook.params.types.${type}`)}
                        </option>
                    ))}
                </CompactSelect>
                <span className="text-[10px] text-muted">=</span>
                <ParamValueControl
                    row={row}
                    invalid={message !== undefined}
                    describedBy={message ? messageId : undefined}
                    onValueChange={changeValue}
                />
                {row.type && !row.required && (
                    <label className={CHECK_LABEL_CLASS}>
                        <input
                            type="checkbox"
                            checked={!!row.isNull}
                            onChange={(e) => onDraftChange({...row, isNull: e.target.checked})}
                            className={CHECKBOX_CLASS}
                        />
                        {t('editor.notebook.params.null')}
                    </label>
                )}
                {row.type && (
                    <label className={CHECK_LABEL_CLASS}>
                        <input
                            type="checkbox"
                            checked={!!row.required}
                            onChange={(e) =>
                                onDraftChange({
                                    ...row,
                                    required: e.target.checked,
                                    // A required parameter cannot be NULL.
                                    ...(e.target.checked ? {isNull: false} : {}),
                                })
                            }
                            className={CHECKBOX_CLASS}
                        />
                        {t('editor.notebook.params.required')}
                    </label>
                )}
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={t('editor.notebook.params.remove')}
                    className="p-0.5 text-muted hover:text-accent-error rounded transition-colors shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                    <X size={12} />
                </button>
            </div>
            {row.type === 'select' && (
                <label className="flex flex-col gap-0.5 text-[10px] text-muted">
                    {t('editor.notebook.params.options')}
                    <textarea
                        autoCorrect="off"
                        autoCapitalize="off"
                        autoComplete="off"
                        spellCheck={false}
                        rows={3}
                        value={(row.options ?? []).join('\n')}
                        onChange={(e) =>
                            onDraftChange({...row, options: e.target.value.split('\n')})
                        }
                        className={`${FIELD_CLASS} resize-y`}
                    />
                </label>
            )}
            {message && (
                <p id={messageId} role="alert" className="text-[10px] text-accent-error">
                    {message}
                </p>
            )}
        </div>
    );
}

function AddParamForm({onAdd}: {onAdd: (name: string, value: string) => void}) {
    const {t} = useTranslation();
    const [name, setName] = useState('');
    const [value, setValue] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = () => {
        const trimmedName = name.trim();
        if (!trimmedName) return;
        if (!validateParamName(trimmedName)) {
            setError(t('editor.notebook.invalidParamName'));
            return;
        }
        onAdd(trimmedName, value);
        setName('');
        setValue('');
        setError('');
    };

    return (
        <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted shrink-0">@</span>
            <input
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                type="text"
                value={name}
                onChange={(e) => {
                    setName(e.target.value);
                    setError('');
                }}
                placeholder={t('editor.notebook.paramName')}
                className="w-24 text-[11px] bg-surface-secondary border border-strong rounded px-1.5 py-0.5 text-primary font-mono outline-none focus:border-focus"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
            <span className="text-[10px] text-muted">=</span>
            <input
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t('editor.notebook.paramValue')}
                className="flex-1 text-[11px] bg-surface-secondary border border-strong rounded px-1.5 py-0.5 text-primary font-mono outline-none focus:border-focus min-w-0"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
            <button
                type="button"
                onClick={handleSubmit}
                className="p-0.5 text-muted hover:text-accent-success rounded transition-colors shrink-0"
            >
                <Plus size={12} />
            </button>
            {error && (
                <span className="text-[9px] text-accent-error absolute -bottom-3 left-0">
                    {error}
                </span>
            )}
        </div>
    );
}

export function ParamsPanel({
    params,
    onParamsChange,
    drafts: notebookDrafts,
    onDraftsChange,
    typedSupported = false,
}: ParamsPanelProps) {
    const {t} = useTranslation();
    const [isExpanded, setIsExpanded] = useState(params.length > 0);
    const [ownDrafts, setOwnDrafts] = useState<ParamDrafts>({});
    const drafts = notebookDrafts ?? ownDrafts;
    const setDrafts = onDraftsChange ?? setOwnDrafts;
    const hasPending = hasPendingParamDrafts(params, drafts);

    return (
        <div className="mx-4 mb-3">
            <div className="flex items-center gap-2 flex-wrap mb-1">
                <button
                    type="button"
                    onClick={() => setIsExpanded((v) => !v)}
                    aria-expanded={isExpanded}
                    className="flex items-center gap-1.5 text-[11px] text-muted hover:text-secondary transition-colors"
                >
                    <Variable size={12} />
                    <span className="font-semibold uppercase">
                        {t('editor.notebook.parameters')}
                    </span>
                    {params.length > 0 && (
                        <span className="text-[9px] bg-surface-secondary rounded px-1 py-0.5">
                            {params.length}
                        </span>
                    )}
                </button>
                {hasPending && (
                    <>
                        <span role="status" className="text-[10px] text-accent-warning">
                            {t('editor.notebook.params.unapplied')}
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                // One change for every row: a single undo step.
                                onParamsChange(applyParamDrafts(params, drafts));
                                setDrafts({});
                            }}
                            disabled={!canApplyParamDrafts(params, drafts)}
                            className={`${ACTION_CLASS} bg-accent-primary text-inverse`}
                        >
                            {t('editor.notebook.params.apply')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setDrafts({})}
                            className={`${ACTION_CLASS} text-muted hover:text-secondary border border-strong`}
                        >
                            {t('editor.notebook.params.discard')}
                        </button>
                    </>
                )}
            </div>

            {isExpanded && (
                <div className="bg-elevated border border-default rounded-lg p-2 space-y-1.5">
                    {params.map((param) => (
                        <ParamRow
                            key={param.name}
                            param={param}
                            draft={draftFor(param, drafts)}
                            typedSupported={typedSupported}
                            onDraftChange={(draft) => setDrafts(withParamDraft(drafts, draft))}
                            onRawValueChange={(value) => {
                                onParamsChange(updateParam(params, param.name, value));
                                setDrafts(withoutParamDraft(drafts, param.name));
                            }}
                            onRemove={() => {
                                onParamsChange(removeParam(params, param.name));
                                setDrafts(withoutParamDraft(drafts, param.name));
                            }}
                        />
                    ))}
                    <AddParamForm
                        onAdd={(name, value) => {
                            onParamsChange(addParam(params, createParam(name, value)));
                            setDrafts(withoutParamDraft(drafts, name));
                        }}
                    />
                    <p className="text-[10px] text-muted">
                        {typedSupported
                            ? t('editor.notebook.params.rawHint')
                            : t('editor.notebook.params.unsupportedDriver')}
                    </p>
                </div>
            )}
        </div>
    );
}
