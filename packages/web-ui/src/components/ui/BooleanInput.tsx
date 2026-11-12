import type {KeyboardEvent} from 'react';

interface BooleanInputProps {
    name: string;
    value: boolean | null;
    nullable?: boolean;
    nullLabel?: string;
    disabled?: boolean;
    autoFocus?: boolean;
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
    onBlur,
    onKeyDown,
    onChange,
}: BooleanInputProps) {
    return (
        <label className="inline-flex items-center gap-2">
            <input
                type="checkbox"
                aria-label={name}
                checked={value === true}
                ref={(element) => {
                    if (element) element.indeterminate = value === null;
                }}
                disabled={disabled}
                autoFocus={autoFocus}
                onBlur={onBlur}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key === ' ') event.stopPropagation();
                    else onKeyDown?.(event);
                }}
                onChange={() =>
                    onChange(value === null ? true : value ? false : nullable ? null : true)
                }
                className="accent-accent-primary disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            />
            <span>{value === null ? nullLabel : value ? 'true' : 'false'}</span>
        </label>
    );
}
