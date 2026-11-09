import {ChevronRight} from 'lucide-react';
import type {PluginResourceListProps} from '@/types/pluginResources';

/** Provider resources use the host's ordinary list and keyboard interaction. */
export function PluginResourceList({items, onOpen, emptyMessage, label}: PluginResourceListProps) {
    if (!items.length) return <p className="py-6 text-sm text-muted">{emptyMessage}</p>;
    return (
        <ul
            aria-label={label}
            className="m-0 w-full list-none divide-y divide-default border-y border-default p-0"
        >
            {items.map((item) => (
                <li key={item.id}>
                    <button
                        type="button"
                        aria-label={item.title}
                        onClick={() => onOpen(item.id)}
                        className="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                    >
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-primary">
                                {item.title}
                            </span>
                            {item.subtitle && (
                                <span className="mt-1 block truncate text-xs text-muted">
                                    {item.subtitle}
                                </span>
                            )}
                        </span>
                        {item.status && (
                            <span className="shrink-0 text-xs text-secondary">{item.status}</span>
                        )}
                        <ChevronRight
                            size={14}
                            aria-hidden="true"
                            className="shrink-0 text-muted"
                        />
                    </button>
                </li>
            ))}
        </ul>
    );
}
