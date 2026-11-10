import {useCallback, useEffect, useRef, useState} from 'react';
import type {Tab} from '@/types/editor';
import {getRecentTabIds, resolveRecentTabId} from '@/utils/tabScroll';

interface TabSwitcherOptions {
    tabs: Tab[];
    activeTabId: string | null;
    connectionId: string | null;
    enabled: boolean;
    getRecentTabIds: () => string[];
    setActiveTabId: (id: string, options?: {preview?: boolean}) => void;
}

export function useTabSwitcher(options: TabSwitcherOptions) {
    const {connectionId, enabled, setActiveTabId} = options;
    const latest = useRef(options);
    const session = useRef<{order: string[]; selectedId: string | null} | null>(null);
    const [order, setOrder] = useState<string[] | null>(null);

    useEffect(() => {
        latest.current = options;
    }, [options]);

    const dismiss = useCallback(() => {
        const current = session.current;
        session.current = null;
        if (current) {
            const {tabs, activeTabId} = latest.current;
            const id = tabs.some((tab) => tab.id === current.selectedId)
                ? current.selectedId
                : activeTabId;
            if (id && tabs.some((tab) => tab.id === id)) setActiveTabId(id);
        }
        setOrder(null);
    }, [setActiveTabId]);

    const select = useCallback(
        (id: string) => {
            session.current = null;
            setOrder(null);
            setActiveTabId(id);
        },
        [setActiveTabId],
    );

    useEffect(() => {
        if (!enabled || !connectionId) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== 'Tab') return;
            const {tabs, activeTabId, getRecentTabIds: getHistory} = latest.current;
            if (!tabs.length) return;
            event.preventDefault();
            if (!session.current) {
                // Pin the current tab first even if activation preceded history's effect.
                session.current = {
                    order: getRecentTabIds(tabs, [activeTabId ?? '', ...getHistory()]),
                    selectedId: activeTabId,
                };
            }
            const current = session.current;
            current.order = getRecentTabIds(tabs, current.order);
            if (!current.order.includes(current.selectedId ?? '')) current.selectedId = activeTabId;
            const next = resolveRecentTabId(current.order, current.selectedId, event.shiftKey);
            current.selectedId = next;
            setOrder(current.order);
            if (next) setActiveTabId(next, {preview: true});
        };
        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === 'Control') dismiss();
        };
        const handleVisibility = () => {
            if (document.hidden) dismiss();
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', dismiss);
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', dismiss);
            document.removeEventListener('visibilitychange', handleVisibility);
            // A connection/focus change must not leave an old switching session open.
            dismiss();
        };
    }, [connectionId, enabled, setActiveTabId, dismiss]);

    const byId = new Map(options.tabs.map((tab) => [tab.id, tab]));
    return {
        isOpen: enabled && order !== null,
        tabs: (order ?? []).flatMap((id) => {
            const tab = byId.get(id);
            return tab ? [tab] : [];
        }),
        select,
        dismiss,
    };
}
