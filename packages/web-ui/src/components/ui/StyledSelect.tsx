import {ChevronDown} from 'lucide-react';

export interface StyledSelectProps {
    id?: string;
    value: string;
    onChange: (value: string) => void;
    options: string[];
    /** Optional display label for each option value (falls back to the value). */
    getOptionLabel?: (value: string) => string;
    ariaLabel?: string;
    ariaDescribedBy?: string;
    disabled?: boolean;
    variant?: 'compact' | 'form';
    active?: boolean;
    className?: string;
}

export const StyledSelect = ({
    id,
    value,
    onChange,
    options,
    getOptionLabel,
    ariaLabel,
    ariaDescribedBy,
    disabled = false,
    variant = 'compact',
    active = false,
    className = '',
}: StyledSelectProps) => (
    <div className={`relative shrink-0 ${className}`}>
        <select
            id={id}
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            disabled={disabled}
            data-active={active || undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full appearance-none bg-base border focus:border-focus focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 transition-colors ${
                variant === 'form'
                    ? 'min-h-10 rounded-lg px-3 pr-9 py-2 text-sm border-strong text-primary hover:enabled:border-focus'
                    : active
                      ? 'border-accent-primary/50 text-accent font-medium hover:border-accent-primary/70'
                      : 'border-default text-secondary hover:border-default/80'
            } ${variant === 'compact' ? 'rounded px-2 pr-6 py-1 text-xs font-mono' : ''}`}
        >
            {options.map((opt) => (
                <option key={opt} value={opt}>
                    {getOptionLabel ? getOptionLabel(opt) : opt}
                </option>
            ))}
        </select>
        <ChevronDown
            size={variant === 'form' ? 15 : 10}
            className={`absolute top-1/2 -translate-y-1/2 text-muted pointer-events-none ${variant === 'form' ? 'right-3' : 'right-1.5'}`}
        />
    </div>
);
