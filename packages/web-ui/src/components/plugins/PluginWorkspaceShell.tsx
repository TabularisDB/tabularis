import {useId} from 'react';
import {Cloud} from 'lucide-react';
import {onAccentColor} from '@/utils/themeContrast';
import type {PluginWorkspaceShellProps} from '@/types/pluginWorkspaceShell';

export function PluginWorkspaceShell({
    title,
    subtitle,
    icon,
    brandColor,
    tabs,
    activeTab,
    onTabChange,
    children,
    actions,
}: PluginWorkspaceShellProps) {
    const prefix = useId();
    const brand = brandColor && /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : undefined;
    const tabId = (id: string) => `${prefix}-${encodeURIComponent(id)}`;
    return (
        <div
            data-plugin-workspace
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-elevated text-primary"
        >
            <header
                data-workspace-header
                className="flex shrink-0 min-w-0 items-center justify-between gap-4 border-b border-default bg-base px-5 py-4 max-sm:px-3 max-sm:py-3"
            >
                <div className="flex min-w-0 items-center gap-3">
                    <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                        style={{
                            backgroundColor: brand ?? 'var(--accent-primary)',
                            color: brand
                                ? (onAccentColor(brand) ?? 'var(--text-inverse)')
                                : 'var(--text-inverse)',
                        }}
                        aria-hidden="true"
                    >
                        {icon ?? <Cloud size={24} />}
                    </span>
                    <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-primary">{title}</h2>
                        {subtitle && <p className="truncate text-xs text-secondary">{subtitle}</p>}
                    </div>
                </div>
                {actions && <div className="min-w-0 max-w-[45%] shrink-0">{actions}</div>}
            </header>
            <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[9rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[auto_minmax(0,1fr)]">
                <div
                    role="tablist"
                    aria-label={title}
                    aria-orientation="vertical"
                    className="min-h-0 overflow-y-auto overscroll-contain border-r border-default bg-base p-2 max-sm:grid max-sm:max-h-36 max-sm:grid-cols-2 max-sm:gap-1 max-sm:border-r-0 max-sm:border-b"
                >
                    {tabs.map((tab, index) => (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            id={tabId(tab.id)}
                            aria-selected={activeTab === tab.id}
                            aria-controls={`${prefix}-content`}
                            tabIndex={activeTab === tab.id ? 0 : -1}
                            onClick={() => onTabChange(tab.id)}
                            onKeyDown={(event) => {
                                const direction = ['ArrowDown', 'ArrowRight'].includes(event.key)
                                    ? 1
                                    : ['ArrowUp', 'ArrowLeft'].includes(event.key)
                                      ? -1
                                      : 0;
                                if (!direction && !['Home', 'End'].includes(event.key)) return;
                                event.preventDefault();
                                const next =
                                    event.key === 'Home'
                                        ? 0
                                        : event.key === 'End'
                                          ? tabs.length - 1
                                          : (index + direction + tabs.length) % tabs.length;
                                onTabChange(tabs[next].id);
                                const buttons =
                                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                                        'button',
                                    );
                                buttons?.[next]?.focus();
                            }}
                            className={`flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${activeTab === tab.id ? 'bg-surface-secondary font-semibold text-primary' : 'text-secondary hover:bg-surface-secondary hover:text-primary'}`}
                            style={
                                activeTab === tab.id
                                    ? {boxShadow: `inset 3px 0 ${brand ?? 'var(--accent-primary)'}`}
                                    : undefined
                            }
                        >
                            <span className="shrink-0" aria-hidden="true">
                                {tab.icon}
                            </span>
                            <span className="truncate">{tab.label}</span>
                        </button>
                    ))}
                </div>
                <section
                    data-workspace-content
                    id={`${prefix}-content`}
                    role="tabpanel"
                    aria-labelledby={tabId(activeTab)}
                    tabIndex={0}
                    className="min-h-0 min-w-0 overflow-auto overscroll-contain p-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus max-sm:p-3"
                >
                    {children}
                </section>
            </div>
        </div>
    );
}
