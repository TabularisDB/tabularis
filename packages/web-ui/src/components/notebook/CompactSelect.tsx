import type {SelectHTMLAttributes} from 'react';
import {ChevronDown} from 'lucide-react';

/**
 * Small native select for notebook result toolbars (chart and KPI settings).
 * `appearance-none` drops the platform widget, which WebKitGTK otherwise draws
 * with the system theme, so the select matches the neighbouring text inputs.
 */
export function CompactSelect({
    className = '',
    children,
    ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
    return (
        <div className="relative inline-flex shrink-0">
            <select
                {...props}
                className={`appearance-none text-[10px] bg-surface-secondary border border-strong rounded pl-1 pr-4 py-0.5 text-secondary cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${className}`}
            >
                {children}
            </select>
            <ChevronDown
                size={10}
                aria-hidden="true"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
        </div>
    );
}
