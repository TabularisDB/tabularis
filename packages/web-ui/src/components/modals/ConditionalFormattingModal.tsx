import {useId, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ArrowDown, ArrowUp, Loader2, Paintbrush, Plus, Trash2, X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {StyledSelect} from '@/components/ui/StyledSelect';
import {getOperatorsForType, type FilterOperator} from '@/utils/filterBar';
import {
    FORMAT_ROW_CLASS,
    FORMAT_SWATCH_CLASS,
    FORMAT_TEXT_CLASS,
    FORMAT_TONES,
    MAX_FORMAT_RULES_PER_TABLE,
    createFormatRule,
    isFormatRuleActive,
    isNoValueOperator,
    type FormatRule,
    type FormatTarget,
    type FormatTone,
} from '@/utils/conditionalFormatting';

/** i18n keys for text-friendly operators (SQL tokens keep their raw labels), as in the filter bar. */
const OPERATOR_LABEL_KEYS: Partial<Record<FilterOperator, string>> = {
    contains: 'toolbar.opContains',
    'starts with': 'toolbar.opStartsWith',
    'ends with': 'toolbar.opEndsWith',
    'is empty': 'toolbar.opIsEmpty',
    'is not empty': 'toolbar.opIsNotEmpty',
};

const TARGETS: FormatTarget[] = ['row', 'cell'];

const FOCUS_CLASS =
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const INPUT_CLASS =
    'w-full min-w-0 px-2 py-1 bg-base border border-default rounded text-xs text-primary font-mono focus:border-focus focus:outline-none aria-[invalid=true]:border-accent-error';

interface ConditionalFormattingModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Table the rules belong to, shown in the subtitle. */
    tableName: string;
    /** Result columns, in order. */
    columns: readonly string[];
    /** Data type of each column, which decides the operators offered. */
    columnTypes: ReadonlyMap<string, string> | null;
    /** Column whose header menu opened the editor: new rules start on it. */
    initialColumn: string;
    rules: readonly FormatRule[];
    onSave: (rules: FormatRule[]) => Promise<void>;
}

/** Whether an enabled rule still lacks a value its operator needs. */
const isIncomplete = (rule: FormatRule) => rule.enabled !== false && !isFormatRuleActive(rule);

/** Editor for the conditional formatting rules of one table (#991). */
export function ConditionalFormattingModal({
    isOpen,
    onClose,
    tableName,
    columns,
    columnTypes,
    initialColumn,
    rules: savedRules,
    onSave,
}: ConditionalFormattingModalProps) {
    const {t} = useTranslation();
    const titleId = useId();
    const idPrefix = useId();
    const [rules, setRules] = useState<FormatRule[]>(() => savedRules.map((rule) => ({...rule})));
    const [showErrors, setShowErrors] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    if (!isOpen) return null;

    const operatorsFor = (column: string) => getOperatorsForType(columnTypes?.get(column) ?? '');
    const operatorLabel = (op: string) => {
        const key = OPERATOR_LABEL_KEYS[op as FilterOperator];
        return key ? t(key) : op;
    };

    const update = (index: number, patch: Partial<FormatRule>) =>
        setRules((current) => current.map((rule, i) => (i === index ? {...rule, ...patch} : rule)));

    const changeColumn = (index: number, column: string) => {
        const operators = operatorsFor(column);
        const operator = operators.includes(rules[index].operator)
            ? rules[index].operator
            : operators[0];
        update(index, {column, operator});
    };

    const move = (index: number, offset: -1 | 1) =>
        setRules((current) => {
            const next = [...current];
            const [rule] = next.splice(index, 1);
            next.splice(index + offset, 0, rule);
            return next;
        });

    const addRule = () => {
        const column = columns.includes(initialColumn) ? initialColumn : (columns[0] ?? '');
        setRules((current) => [...current, createFormatRule(column, operatorsFor(column)[0])]);
    };

    const save = async () => {
        if (rules.some(isIncomplete)) {
            setShowErrors(true);
            return;
        }
        setSaving(true);
        setSaveError(null);
        try {
            await onSave(rules.map((rule) => ({...rule, name: rule.name.trim()})));
            onClose();
        } catch (error) {
            setSaveError(t('dataGrid.conditionalFormatting.saveFailed', {error: String(error)}));
        } finally {
            setSaving(false);
        }
    };

    const atLimit = rules.length >= MAX_FORMAT_RULES_PER_TABLE;

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <form
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-elevated border border-strong rounded-xl shadow-2xl w-[760px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col"
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-primary/15 rounded-lg">
                            <Paintbrush size={20} className="text-accent" />
                        </div>
                        <div>
                            <h2 id={titleId} className="text-lg font-semibold text-primary">
                                {t('dataGrid.conditionalFormatting.title')}
                            </h2>
                            <p className="text-xs text-secondary">
                                {t('dataGrid.conditionalFormatting.subtitle', {table: tableName})}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('common.close')}
                        className={`text-secondary hover:text-primary transition-colors ${FOCUS_CLASS}`}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto">
                    <div className="bg-surface-secondary/50 p-4 rounded-lg border border-strong">
                        <p className="text-sm text-secondary leading-relaxed">
                            {t('dataGrid.conditionalFormatting.description')}
                        </p>
                    </div>

                    {rules.length === 0 && (
                        <p className="text-sm text-muted text-center py-4">
                            {t('dataGrid.conditionalFormatting.empty')}
                        </p>
                    )}

                    <ol className="space-y-3">
                        {rules.map((rule, index) => {
                            const id = `${idPrefix}-${rule.id}`;
                            const noValue = isNoValueOperator(rule.operator);
                            const isBetween = rule.operator === 'BETWEEN';
                            const invalid = showErrors && isIncomplete(rule);
                            const label = rule.name.trim() || rule.column;
                            return (
                                <li
                                    key={rule.id}
                                    aria-label={t('dataGrid.conditionalFormatting.ruleLabel', {
                                        index: index + 1,
                                    })}
                                    className={`bg-base p-3 rounded-lg border space-y-2 ${
                                        invalid ? 'border-accent-error' : 'border-default'
                                    } ${rule.enabled === false ? 'opacity-60' : ''}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-muted w-5 text-right">
                                            {index + 1}
                                        </span>
                                        <label className="flex items-center gap-1 text-xs text-secondary cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={rule.enabled !== false}
                                                onChange={(e) =>
                                                    update(index, {enabled: e.target.checked})
                                                }
                                                className={`accent-accent-primary cursor-pointer rounded ${FOCUS_CLASS}`}
                                            />
                                            {t('dataGrid.conditionalFormatting.enabled')}
                                        </label>
                                        <label htmlFor={`${id}-name`} className="sr-only">
                                            {t('dataGrid.conditionalFormatting.name')}
                                        </label>
                                        <input
                                            id={`${id}-name`}
                                            type="text"
                                            autoComplete="off"
                                            value={rule.name}
                                            maxLength={80}
                                            onChange={(e) => update(index, {name: e.target.value})}
                                            placeholder={t(
                                                'dataGrid.conditionalFormatting.namePlaceholder',
                                            )}
                                            className={`${INPUT_CLASS} flex-1 font-sans`}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => move(index, -1)}
                                            disabled={index === 0}
                                            aria-label={t('dataGrid.conditionalFormatting.moveUp')}
                                            title={t('dataGrid.conditionalFormatting.moveUp')}
                                            className={`p-1 rounded text-secondary hover:text-primary disabled:opacity-30 ${FOCUS_CLASS}`}
                                        >
                                            <ArrowUp size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => move(index, 1)}
                                            disabled={index === rules.length - 1}
                                            aria-label={t(
                                                'dataGrid.conditionalFormatting.moveDown',
                                            )}
                                            title={t('dataGrid.conditionalFormatting.moveDown')}
                                            className={`p-1 rounded text-secondary hover:text-primary disabled:opacity-30 ${FOCUS_CLASS}`}
                                        >
                                            <ArrowDown size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setRules((current) =>
                                                    current.filter((_, i) => i !== index),
                                                )
                                            }
                                            aria-label={t('dataGrid.conditionalFormatting.remove')}
                                            title={t('dataGrid.conditionalFormatting.remove')}
                                            className={`p-1 rounded text-secondary hover:text-accent-error ${FOCUS_CLASS}`}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-2 pl-7">
                                        <StyledSelect
                                            value={rule.column}
                                            onChange={(column) => changeColumn(index, column)}
                                            options={[...columns]}
                                            ariaLabel={t('dataGrid.conditionalFormatting.column')}
                                            className="w-40"
                                        />
                                        <StyledSelect
                                            value={rule.operator}
                                            onChange={(op) =>
                                                update(index, {operator: op as FilterOperator})
                                            }
                                            options={operatorsFor(rule.column)}
                                            getOptionLabel={operatorLabel}
                                            ariaLabel={t('dataGrid.conditionalFormatting.operator')}
                                            className="w-36"
                                        />
                                        {!noValue && (
                                            <input
                                                type="text"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={rule.value}
                                                aria-invalid={invalid || undefined}
                                                aria-label={t(
                                                    'dataGrid.conditionalFormatting.value',
                                                )}
                                                onChange={(e) =>
                                                    update(index, {value: e.target.value})
                                                }
                                                placeholder={
                                                    isBetween
                                                        ? t('toolbar.fromPlaceholder')
                                                        : t('toolbar.valuePlaceholder')
                                                }
                                                className={`${INPUT_CLASS} flex-1`}
                                            />
                                        )}
                                        {isBetween && (
                                            <input
                                                type="text"
                                                autoComplete="off"
                                                spellCheck={false}
                                                value={rule.value2 ?? ''}
                                                aria-invalid={invalid || undefined}
                                                aria-label={t(
                                                    'dataGrid.conditionalFormatting.valueTo',
                                                )}
                                                onChange={(e) =>
                                                    update(index, {value2: e.target.value})
                                                }
                                                placeholder={t('toolbar.toPlaceholder')}
                                                className={`${INPUT_CLASS} flex-1`}
                                            />
                                        )}
                                        {noValue && <div className="flex-1" />}
                                    </div>

                                    <div className="flex items-center gap-2 pl-7">
                                        <span
                                            aria-hidden
                                            className={`w-3 h-3 rounded-full shrink-0 ${FORMAT_SWATCH_CLASS[rule.tone]}`}
                                        />
                                        <StyledSelect
                                            value={rule.tone}
                                            onChange={(tone) =>
                                                update(index, {tone: tone as FormatTone})
                                            }
                                            options={[...FORMAT_TONES]}
                                            getOptionLabel={(tone) =>
                                                t(`dataGrid.conditionalFormatting.tones.${tone}`)
                                            }
                                            ariaLabel={t('dataGrid.conditionalFormatting.tone')}
                                            className="w-32"
                                        />
                                        <StyledSelect
                                            value={rule.target}
                                            onChange={(target) =>
                                                update(index, {target: target as FormatTarget})
                                            }
                                            options={TARGETS}
                                            getOptionLabel={(target) =>
                                                target === 'row'
                                                    ? t('dataGrid.conditionalFormatting.targetRow')
                                                    : t('dataGrid.conditionalFormatting.targetCell')
                                            }
                                            ariaLabel={t('dataGrid.conditionalFormatting.target')}
                                            className="w-44"
                                        />
                                        <span
                                            className={`ml-auto px-2 py-0.5 rounded text-xs font-result truncate max-w-[220px] border border-default ${
                                                rule.target === 'row'
                                                    ? `${FORMAT_ROW_CLASS[rule.tone]} ${rule.tone === 'muted' ? FORMAT_TEXT_CLASS.muted : 'text-primary'}`
                                                    : FORMAT_TEXT_CLASS[rule.tone]
                                            }`}
                                            title={t('dataGrid.conditionalFormatting.preview')}
                                        >
                                            {label || t('dataGrid.conditionalFormatting.preview')}
                                        </span>
                                    </div>
                                    {invalid && (
                                        <p className="pl-7 text-xs text-accent-error">
                                            {t('dataGrid.conditionalFormatting.incomplete')}
                                        </p>
                                    )}
                                </li>
                            );
                        })}
                    </ol>

                    <button
                        type="button"
                        onClick={addRule}
                        disabled={atLimit || columns.length === 0}
                        className={`flex items-center gap-2 px-3 py-1.5 text-sm text-accent hover:text-primary rounded-lg border border-dashed border-strong disabled:opacity-50 ${FOCUS_CLASS}`}
                    >
                        <Plus size={14} />
                        {t('dataGrid.conditionalFormatting.addRule')}
                    </button>
                    {atLimit && (
                        <p className="text-xs text-muted">
                            {t('dataGrid.conditionalFormatting.maxRules', {
                                count: MAX_FORMAT_RULES_PER_TABLE,
                            })}
                        </p>
                    )}
                </div>

                <div className="p-4 border-t border-default bg-base/50 flex items-center justify-end gap-3">
                    {saveError && (
                        <p role="alert" className="mr-auto text-xs text-accent-error">
                            {saveError}
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className={`px-4 py-2 text-secondary hover:text-primary transition-colors text-sm ${FOCUS_CLASS}`}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className={`px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 disabled:opacity-50 text-inverse rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${FOCUS_CLASS}`}
                    >
                        {saving && <Loader2 size={16} className="animate-spin" />}
                        {t('common.save')}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
