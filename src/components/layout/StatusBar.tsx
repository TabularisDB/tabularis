import { useEffect, useState } from 'react';
import {
  Database,
  Cog,
  Activity,
  GitBranch,
  Clock,
  AlertCircle,
  Rows3,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useDatabase } from '../../hooks/useDatabase';
import { useConnectionLayoutContext } from '../../hooks/useConnectionLayoutContext';
import { APP_VERSION } from '../../version';
import { onQueryStats, type QueryStats } from '../../utils/queryStats';

export const StatusBar = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    activeConnectionId,
    connections,
    connectionDataMap,
    openConnectionIds,
  } = useDatabase();
  const { splitView, isSplitVisible } = useConnectionLayoutContext();

  const activeConn = connections.find((c) => c.id === activeConnectionId) ?? null;
  const activeData = activeConnectionId
    ? connectionDataMap[activeConnectionId]
    : undefined;
  const driverId = activeConn?.params.driver ?? activeData?.driver ?? null;
  const dbName =
    activeData?.databaseName ||
    (Array.isArray(activeConn?.params.database)
      ? activeConn?.params.database[0]
      : activeConn?.params.database) ||
    null;

  const splitActive = !!splitView && isSplitVisible;

  const [stats, setStats] = useState<QueryStats | null>(null);
  useEffect(() => {
    return onQueryStats(setStats);
  }, []);

  return (
    <footer className="h-7 bg-elevated border-t border-default flex items-center justify-between px-3 text-[11px] text-muted shrink-0 select-none">
      {/* Left cluster — connection identity */}
      <div className="flex items-center gap-2 min-w-0">
        {activeConn ? (
          <button
            onClick={() => navigate('/connections')}
            className="flex items-center gap-1.5 hover:text-secondary transition-colors min-w-0"
            title={t('statusBar.openConnections')}
          >
            <Database size={12} className="text-accent-info shrink-0" />
            <span className="font-mono truncate max-w-[200px]">
              {activeConn.name}
            </span>
          </button>
        ) : (
          <span className="flex items-center gap-1.5">
            <Database size={12} />
            <span>{t('statusBar.noConnection')}</span>
          </span>
        )}

        {driverId && (
          <>
            <span className="text-disabled">·</span>
            <span className="uppercase tracking-wide text-disabled">
              {driverId}
            </span>
          </>
        )}

        {dbName && (
          <>
            <span className="text-disabled">·</span>
            <span className="flex items-center gap-1 text-secondary">
              <GitBranch size={11} />
              <span className="font-mono truncate max-w-[160px]">{dbName}</span>
            </span>
          </>
        )}

        {splitActive && (
          <>
            <span className="text-disabled">·</span>
            <span className="text-accent-secondary">
              {t('statusBar.splitActive', {
                count: splitView?.connectionIds.length ?? 0,
              })}
            </span>
          </>
        )}
      </div>

      {/* Right cluster — query stats + app status */}
      <div className="flex items-center gap-2 shrink-0">
        {stats && (
          <>
            {stats.error ? (
              <span
                className="flex items-center gap-1 text-error-text max-w-[260px]"
                title={stats.error}
              >
                <AlertCircle size={11} />
                <span className="truncate">{stats.error}</span>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span
                  className="flex items-center gap-1 text-secondary"
                  title={t('statusBar.rowsTitle')}
                >
                  <Rows3 size={11} />
                  <span className="font-mono">
                    {stats.rows !== null
                      ? stats.rows.toLocaleString()
                      : '—'}
                  </span>
                </span>
                <span
                  className={clsx(
                    'flex items-center gap-1',
                    stats.durationMs > 1000
                      ? 'text-warning-text'
                      : 'text-secondary',
                  )}
                  title={t('statusBar.durationTitle')}
                >
                  <Clock size={11} />
                  <span className="font-mono">
                    {formatDuration(stats.durationMs)}
                  </span>
                </span>
              </span>
            )}
            <span className="text-disabled">·</span>
          </>
        )}

        <span className="flex items-center gap-1.5">
          <Activity size={11} className="text-accent-success" />
          <span>
            {openConnectionIds.length > 0
              ? t('statusBar.connected', { count: openConnectionIds.length })
              : t('statusBar.idle')}
          </span>
        </span>

        <span className="text-disabled">·</span>

        <span className="font-mono text-disabled">v{APP_VERSION}</span>

        <button
          onClick={() => {
            if (location.pathname !== '/settings') navigate('/settings');
          }}
          className="ml-1 p-1 rounded hover:bg-surface-hover hover:text-secondary transition-colors"
          title={t('sidebar.settings')}
        >
          <Cog size={12} />
        </button>
      </div>
    </footer>
  );
};

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
