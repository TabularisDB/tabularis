import {ArrowUpRight, Cloud} from 'lucide-react';
import {onAccentColor} from '@/utils/themeContrast';
import type {PluginConnectionActionProps} from '@/types/pluginWorkspace';

export function PluginConnectionAction({
    providerName,
    label,
    description,
    icon,
    brandColor,
    disabled,
    onClick,
}: PluginConnectionActionProps) {
    const brand = brandColor && /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : undefined;
    return (
        <button
            type="button"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            data-provider-action={providerName}
            className="group flex w-full cursor-pointer min-w-0 items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-left shadow-sm transition hover:brightness-105 active:brightness-95 disabled:cursor-default disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            style={{
                backgroundColor: brand ?? 'var(--accent-primary)',
                color: brand
                    ? (onAccentColor(brand) ?? 'var(--text-inverse)')
                    : 'var(--text-inverse)',
            }}
        >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden="true">
                {icon ?? <Cloud size={24} />}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{providerName}</span>
                {description && (
                    <span className="block truncate text-xs opacity-80">{description}</span>
                )}
            </span>
            <ArrowUpRight size={18} className="shrink-0" aria-hidden="true" />
        </button>
    );
}
