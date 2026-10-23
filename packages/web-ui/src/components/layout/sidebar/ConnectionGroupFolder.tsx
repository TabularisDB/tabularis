import type {ReactNode} from 'react';
import {Folder, FolderOpen} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {RailIndicator} from './RailIndicator';

interface Props {
    name: string;
    path: string;
    count: number;
    isCollapsed: boolean;
    hasActiveConnection: boolean;
    onToggle: () => void;
    children: ReactNode;
}

export const ConnectionGroupFolder = ({
    name,
    path,
    count,
    isCollapsed,
    hasActiveConnection,
    onToggle,
    children,
}: Props) => {
    const {t} = useTranslation();

    return (
        <div className="w-full flex flex-col items-center">
            <div className="relative group w-full flex flex-col items-center mb-0.5">
                <RailIndicator isActive={isCollapsed && hasActiveConnection} />
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={!isCollapsed}
                    aria-label={path}
                    className="flex items-center justify-center w-12 h-10 rounded-lg transition-all text-muted hover:text-secondary hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                    <div className="relative">
                        {isCollapsed ? (
                            <Folder size={20} className="text-accent-warning/70" />
                        ) : (
                            <FolderOpen size={20} className="text-accent-warning" />
                        )}
                        <div className="absolute -bottom-1 -right-1.5 min-w-[14px] h-[14px] bg-surface-secondary border border-default rounded-full flex items-center justify-center text-[9px] font-bold text-secondary px-0.5">
                            {count}
                        </div>
                    </div>
                </button>

                <span className="text-[9px] text-muted leading-tight max-w-[56px] truncate text-center select-none">
                    {name}
                </span>

                <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-surface-secondary text-primary text-xs px-2 py-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-30 pointer-events-none shadow-lg border border-default">
                    <div className="font-medium">{path}</div>
                    <div className="text-muted text-[10px]">
                        {count} {count === 1 ? t('groups.connection') : t('groups.connections')}
                    </div>
                </div>
            </div>

            {!isCollapsed && (
                <div className="w-full flex flex-col items-center bg-surface-secondary/40 pt-1 mb-1">
                    {children}
                </div>
            )}
        </div>
    );
};
