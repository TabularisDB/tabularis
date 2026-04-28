import { useState, useEffect, useMemo, useCallback, type KeyboardEvent, type ElementType } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Plug2, Cpu, Settings, Database, Layers, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { Modal } from '../ui/Modal';
import { useConnectionManager } from '../../hooks/useConnectionManager';
import { useDrivers } from '../../hooks/useDrivers';
import { getDriverColor } from '../../utils/driverUI';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: ElementType;
  iconColor?: string;
  hint?: string;
  action: () => void;
  loading?: boolean;
}

export const CommandPalette = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const navigate = useNavigate();
  const {
    connections,
    openConnections,
    activeConnectionId,
    handleConnect,
    handleSwitch,
    connectingId,
  } = useConnectionManager();
  const { allDrivers } = useDrivers();

  useEffect(() => {
    const onOpenEvent = () => {
      setOpen((v) => !v);
      setQuery('');
      setHighlightedIdx(0);
    };
    window.addEventListener('tabularis:open-command-palette', onOpenEvent);
    return () =>
      window.removeEventListener(
        'tabularis:open-command-palette',
        onOpenEvent,
      );
  }, []);

  useEffect(() => setHighlightedIdx(0), [query]);

  const close = useCallback(() => setOpen(false), []);

  const groupActions = t('commandPalette.groupActions');
  const groupOpen = t('commandPalette.groupOpen');
  const groupAvailable = t('commandPalette.groupAvailable');

  const openIds = useMemo(
    () => new Set(openConnections.map((c) => c.id)),
    [openConnections],
  );

  const commands: Command[] = useMemo(() => {
    const base: Command[] = [
      {
        id: 'route:connections',
        label: t('commandPalette.openConnections'),
        group: groupActions,
        icon: Plug2,
        action: () => navigate('/connections'),
      },
      {
        id: 'route:mcp',
        label: t('commandPalette.openMcp'),
        group: groupActions,
        icon: Cpu,
        action: () => navigate('/mcp'),
      },
      {
        id: 'route:settings',
        label: t('commandPalette.openSettings'),
        group: groupActions,
        icon: Settings,
        action: () => navigate('/settings'),
      },
    ];

    for (const conn of connections) {
      const isOpen = openIds.has(conn.id);
      const isActive = activeConnectionId === conn.id;
      const isConnecting = connectingId === conn.id;
      const driverManifest = allDrivers.find((d) => d.id === conn.driver);
      const driverColor = getDriverColor(driverManifest);

      const subtitle = conn.database
        ? `${conn.driver} · ${conn.database}`
        : conn.driver;

      base.push({
        id: `conn:${conn.id}`,
        label: isActive
          ? t('commandPalette.alreadyActive', { name: conn.name })
          : isOpen
            ? t('commandPalette.switchTo', { name: conn.name })
            : t('commandPalette.connectTo', { name: conn.name }),
        group: isOpen ? groupOpen : groupAvailable,
        icon: Database,
        iconColor: driverColor,
        hint: subtitle,
        loading: isConnecting,
        action: async () => {
          if (isActive) {
            navigate('/editor');
            return;
          }
          if (isOpen) {
            handleSwitch(conn.id);
            navigate('/editor');
            return;
          }
          try {
            await handleConnect(conn.id);
            handleSwitch(conn.id);
            navigate('/editor');
          } catch {
            // Error already surfaced by handleConnect via useConnectionManager
          }
        },
      });
    }

    return base;
  }, [
    connections,
    openIds,
    activeConnectionId,
    connectingId,
    allDrivers,
    navigate,
    handleConnect,
    handleSwitch,
    t,
    groupActions,
    groupOpen,
    groupAvailable,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [query, commands]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Command[]>();
    for (const c of filtered) {
      const arr = groups.get(c.group) ?? [];
      arr.push(c);
      groups.set(c.group, arr);
    }
    return groups;
  }, [filtered]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx((i) =>
        filtered.length === 0 ? 0 : Math.min(filtered.length - 1, i + 1),
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[highlightedIdx];
      if (cmd) {
        cmd.action();
        close();
      }
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      overlayClassName="fixed inset-0 bg-black/40 flex items-start justify-center pt-24 z-[100] backdrop-blur-sm animate-fade-in"
    >
      <div
        className="w-[560px] max-w-[92vw] bg-elevated border border-default rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 h-12 border-b border-default shrink-0">
          <Search size={16} className="text-muted shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPalette.placeholder')}
            className="flex-1 bg-transparent outline-none text-sm text-primary placeholder:text-muted"
          />
          <kbd className="text-[10px] text-muted bg-surface-secondary px-1.5 py-0.5 rounded font-mono">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[420px] overflow-y-auto custom-scrollbar py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted">
              <Layers size={20} className="mx-auto mb-2 opacity-40" />
              {t('commandPalette.noResults')}
            </div>
          ) : (
            Array.from(grouped.entries()).map(([group, items]) => (
              <div key={group} className="mb-2 last:mb-0">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted font-medium">
                  {group}
                </div>
                {items.map((cmd) => {
                  const idxInFiltered = filtered.indexOf(cmd);
                  const isActive = idxInFiltered === highlightedIdx;
                  const Icon = cmd.icon;
                  return (
                    <button
                      key={cmd.id}
                      onClick={() => {
                        const result = cmd.action();
                        // Keep palette open if the action returns a Promise so
                        // the user can see the loading state of the row.
                        if (!(result instanceof Promise)) {
                          close();
                        } else {
                          result.finally(() => close());
                        }
                      }}
                      onMouseEnter={() => setHighlightedIdx(idxInFiltered)}
                      className={clsx(
                        'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
                        isActive
                          ? 'bg-surface-hover text-primary'
                          : 'text-secondary',
                      )}
                    >
                      {cmd.loading ? (
                        <Loader2
                          size={14}
                          className="text-accent-primary shrink-0 animate-spin"
                        />
                      ) : (
                        <Icon
                          size={14}
                          className="shrink-0"
                          style={{
                            color: cmd.iconColor ?? 'var(--text-muted)',
                          }}
                        />
                      )}
                      <span className="flex-1 text-sm truncate">
                        {cmd.label}
                      </span>
                      {cmd.hint && (
                        <span className="text-[10px] text-muted tracking-wide font-mono shrink-0 ml-2">
                          {cmd.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="border-t border-default px-3 h-8 flex items-center gap-3 text-[10px] text-muted shrink-0">
          <span className="flex items-center gap-1">
            <kbd className="bg-surface-secondary px-1 py-0.5 rounded font-mono">
              ↑↓
            </kbd>
            {t('commandPalette.navigate')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-surface-secondary px-1 py-0.5 rounded font-mono">
              ↵
            </kbd>
            {t('commandPalette.open')}
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <kbd className="bg-surface-secondary px-1 py-0.5 rounded font-mono">
              esc
            </kbd>
            {t('commandPalette.close')}
          </span>
        </div>
      </div>
    </Modal>
  );
};
