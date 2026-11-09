import {
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
    type InputHTMLAttributes,
    type RefObject,
} from 'react';
import {createPortal} from 'react-dom';
import {Check, ChevronDown, Loader2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useEscapeKey} from '@/hooks/useEscapeKey';
import {
    computeDropdownPosition,
    dropdownPositionStyle,
    type DropdownPosition,
} from '@/utils/dropdownPosition';
import type {PluginSelectProps} from '@/types/pluginSelect';

function SelectInput({
    inputRef,
    loading,
    ...props
}: InputHTMLAttributes<HTMLInputElement> & {
    inputRef?: RefObject<HTMLInputElement | null>;
    loading?: boolean;
}) {
    return (
        <div className="relative min-w-0">
            <input
                {...props}
                ref={inputRef}
                type="text"
                role="combobox"
                aria-controls={props['aria-controls']}
                aria-expanded={props['aria-expanded'] ?? false}
                autoComplete="off"
                spellCheck={false}
                aria-busy={loading || undefined}
                className={`min-h-10 w-full min-w-0 appearance-none rounded-lg border border-strong bg-base px-3 py-2 pr-9 text-sm text-primary placeholder:text-muted transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${loading ? 'cursor-wait' : 'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50'}`}
            />
            {loading ? (
                <Loader2
                    size={15}
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 -mt-[7.5px] animate-spin text-accent motion-reduce:animate-none"
                />
            ) : (
                <ChevronDown
                    size={15}
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
                />
            )}
        </div>
    );
}

/** Provider selection owns its themed popup, search and accessible keyboard interaction. */
export function PluginSelect(props: PluginSelectProps) {
    const {t} = useTranslation();
    const label = props.options.find((option) => option.value === props.value)?.label ?? '';
    if (props.disabled || props.loading) {
        const loadingLabel = props.loadingLabel ?? t('common.loading');
        return (
            <>
                <SelectInput
                    id={props.id}
                    aria-label={props.ariaLabel}
                    aria-describedby={props.ariaDescribedBy}
                    aria-expanded={false}
                    value={props.loading ? loadingLabel : label}
                    placeholder={props.placeholder}
                    loading={props.loading}
                    disabled
                    readOnly
                />
                {props.loading && (
                    <span role="status" className="sr-only">
                        {loadingLabel}
                    </span>
                )}
            </>
        );
    }
    return <SelectableField {...props} displayLabel={label} />;
}

function SelectableField({
    id,
    ariaLabel,
    ariaDescribedBy,
    value,
    options,
    onChange,
    placeholder,
    displayLabel,
}: PluginSelectProps & {displayLabel: string}) {
    const {t} = useTranslation();
    const listId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<DropdownPosition | null>(null);
    const [query, setQuery] = useState('');
    const [highlight, setHighlight] = useState(0);
    const open = position !== null;
    const filtered = options.filter((option) =>
        `${option.label} ${option.description ?? ''}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
    );
    const active = Math.min(highlight, Math.max(0, filtered.length - 1));
    const optionId = (index: number) => `${listId}-${index}`;
    const close = useCallback(() => setPosition(null), []);
    useEscapeKey(open, close);

    const updatePosition = useCallback(() => {
        if (inputRef.current)
            setPosition(computeDropdownPosition(inputRef.current.getBoundingClientRect()));
    }, []);
    const show = () => {
        setQuery('');
        setHighlight(
            Math.max(
                0,
                options.findIndex((option) => option.value === value),
            ),
        );
        updatePosition();
    };
    const select = (selected: string) => {
        close();
        onChange(selected);
    };

    useEffect(() => {
        if (!open) return;
        const outside = (event: MouseEvent) => {
            if (
                !inputRef.current?.contains(event.target as Node) &&
                !popupRef.current?.contains(event.target as Node)
            )
                close();
        };
        document.addEventListener('mousedown', outside);
        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);
        return () => {
            document.removeEventListener('mousedown', outside);
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [open, close, updatePosition]);
    useEffect(() => {
        if (open)
            popupRef.current
                ?.querySelector('[data-highlighted="true"]')
                ?.scrollIntoView?.({block: 'nearest'});
    }, [open, active]);

    return (
        <>
            <SelectInput
                inputRef={inputRef}
                id={id}
                aria-label={ariaLabel}
                aria-describedby={ariaDescribedBy}
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-autocomplete="list"
                aria-activedescendant={open && filtered.length ? optionId(active) : undefined}
                value={open ? query : displayLabel}
                placeholder={open ? t('common.search') : placeholder}
                onFocus={(event) => event.currentTarget.select()}
                onClick={() => {
                    if (!open) show();
                }}
                onBlur={close}
                onChange={(event) => {
                    setQuery(event.target.value);
                    setHighlight(0);
                    if (!open) updatePosition();
                }}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        if (!open) show();
                        else
                            setHighlight(
                                (active + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) %
                                    Math.max(1, filtered.length),
                            );
                    } else if (open && (event.key === 'Home' || event.key === 'End')) {
                        event.preventDefault();
                        setHighlight(event.key === 'Home' ? 0 : Math.max(0, filtered.length - 1));
                    } else if (open && event.key === 'Enter') {
                        event.preventDefault();
                        if (filtered[active]) select(filtered[active].value);
                    }
                }}
            />
            {position &&
                createPortal(
                    <div
                        ref={popupRef}
                        id={listId}
                        role="listbox"
                        aria-label={ariaLabel}
                        data-plugin-select-menu
                        className="fixed z-[10050] overflow-y-auto overscroll-contain rounded-lg border border-strong bg-elevated p-1 shadow-xl"
                        style={dropdownPositionStyle(position)}
                    >
                        {filtered.length ? (
                            filtered.map((option, index) => (
                                <button
                                    key={option.value}
                                    id={optionId(index)}
                                    type="button"
                                    role="option"
                                    tabIndex={-1}
                                    aria-selected={option.value === value}
                                    data-value={option.value}
                                    data-highlighted={index === active}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseMove={() => setHighlight(index)}
                                    onClick={() => select(option.value)}
                                    className={`flex min-h-9 w-full cursor-pointer items-center gap-3 rounded px-3 py-2 text-left text-sm text-primary ${index === active ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}`}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span
                                            className={`block truncate ${option.value === value ? 'font-medium' : ''}`}
                                        >
                                            {option.label}
                                        </span>
                                        {option.description && (
                                            <span className="mt-0.5 block truncate text-xs text-muted">
                                                {option.description}
                                            </span>
                                        )}
                                    </span>
                                    {option.value === value && (
                                        <Check
                                            size={15}
                                            aria-hidden="true"
                                            className="shrink-0 text-accent"
                                        />
                                    )}
                                </button>
                            ))
                        ) : (
                            <p className="px-3 py-4 text-sm text-muted" role="status">
                                {t('common.noResults')}
                            </p>
                        )}
                    </div>,
                    document.body,
                )}
        </>
    );
}
