import type {KeyboardEvent} from 'react';

interface BooleanInputProps {
    name: string;
    value: boolean | null;
    nullable?: boolean;
    nullLabel?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    /** Grid display cells: stay out of the tab order and keep focus on the grid. */
    display?: boolean;
    onBlur?: () => void;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    onChange: (value: boolean | null) => void;
}

export function BooleanInput({
    name,
    value,
    nullable,
    nullLabel = 'NULL',
    disabled,
    autoFocus,
    display,
    onBlur,
    onKeyDown,
    onChange,
}: BooleanInputProps) {
    return (
        <span className="inline-flex items-center gap-2">
            <input
                type="checkbox"
                aria-label={name}
                checked={value === true}
                tabIndex={display ? -1 : undefined}
                ref={(element) => {
                    if (element) element.indeterminate = value === null;
                }}
                disabled={disabled}
                autoFocus={autoFocus}
                onBlur={onBlur}
                onMouseDown={display ? (event) => event.preventDefault() : undefined}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (
                        event.key === ' ' &&
                        !event.altKey &&
                        !event.ctrlKey &&
                        !event.metaKey &&
                        !event.shiftKey
                    ) {
                        event.stopPropagation();
                    } else {
                        onKeyDown?.(event);
                    }
                }}
                onChange={() =>
                    onChange(value === null ? true : value ? false : nullable ? null : true)
                }
                className="accent-accent-primary disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            />
            <span>{value === null ? nullLabel : value ? 'true' : 'false'}</span>
        </span>
    );
}
