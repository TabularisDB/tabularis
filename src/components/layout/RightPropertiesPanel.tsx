import { type ReactNode } from 'react';
import { X, Sliders, BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useDatabase } from '../../hooks/useDatabase';
import { useDrivers } from '../../hooks/useDrivers';
import { TableSchemaSection } from './properties/TableSchemaSection';

interface RightPropertiesPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RightPropertiesPanel = ({
  isOpen,
  onClose,
}: RightPropertiesPanelProps) => {
  const { t } = useTranslation();
  const {
    activeConnectionId,
    connections,
    connectionDataMap,
    activeTable,
    tables,
    views,
    routines,
  } = useDatabase();
  const { allDrivers } = useDrivers();

  if (!isOpen) return null;

  const activeConn = connections.find((c) => c.id === activeConnectionId);
  const driver = activeConn
    ? allDrivers.find((d) => d.id === activeConn.params.driver)
    : null;
  const connData = activeConnectionId
    ? connectionDataMap[activeConnectionId]
    : null;

  const driverLabel = driver?.name ?? activeConn?.params.driver ?? '—';

  const dbField = activeConn?.params.database;
  const dbName =
    connData?.databaseName ||
    (Array.isArray(dbField) ? dbField[0] : dbField) ||
    '—';

  return (
    <aside className="w-72 bg-elevated border-l border-default flex flex-col shrink-0 animate-slide-in-right">
      {/* Header */}
      <div className="h-9 px-3 border-b border-default flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 text-secondary">
          <Sliders size={13} />
          <span className="text-xs font-medium tracking-wide uppercase">
            {t('properties.title')}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-hover text-muted hover:text-secondary transition-colors"
          title={t('properties.close')}
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {!activeConn ? (
          <EmptyState message={t('properties.noSelection')} />
        ) : (
          <div className="p-3 space-y-5">
            {/* Identity */}
            <Section>
              <SectionLabel>{t('properties.connection')}</SectionLabel>
              <Row
                label={t('properties.name')}
                value={activeConn.name}
                accent
              />
              <Row label={t('properties.driver')} value={driverLabel} />
              <Row
                label={t('properties.status')}
                value={
                  connData?.isConnected
                    ? t('properties.statusConnected')
                    : connData?.isConnecting
                      ? t('properties.statusConnecting')
                      : t('properties.statusIdle')
                }
                badge={connData?.isConnected ? 'success' : 'muted'}
              />
            </Section>

            {/* Address */}
            {(activeConn.params.host || activeConn.params.port) && (
              <Section>
                <SectionLabel>{t('properties.address')}</SectionLabel>
                {activeConn.params.host && (
                  <Row
                    label={t('properties.host')}
                    value={activeConn.params.host}
                  />
                )}
                {activeConn.params.port !== undefined && (
                  <Row
                    label={t('properties.port')}
                    value={String(activeConn.params.port)}
                  />
                )}
                {activeConn.params.username && (
                  <Row
                    label={t('properties.username')}
                    value={activeConn.params.username}
                  />
                )}
                {activeConn.params.ssh_enabled && (
                  <Row label={t('properties.ssh')} value="enabled" />
                )}
              </Section>
            )}

            {/* Database/session */}
            {connData && (
              <Section>
                <SectionLabel>{t('properties.session')}</SectionLabel>
                <Row label={t('properties.database')} value={dbName} />
                {connData.activeSchema && (
                  <Row
                    label={t('properties.schema')}
                    value={connData.activeSchema}
                  />
                )}
                <Row
                  label={t('properties.tables')}
                  value={String(tables.length)}
                />
                <Row
                  label={t('properties.views')}
                  value={String(views.length)}
                />
                <Row
                  label={t('properties.routines')}
                  value={String(routines.length)}
                />
              </Section>
            )}

            {/* Active table */}
            {activeTable && (
              <Section>
                <SectionLabel icon={BookOpen}>
                  {t('properties.activeTable')}
                </SectionLabel>
                <Row label={t('properties.name')} value={activeTable} accent />
              </Section>
            )}

            {/* Table schema (columns / indexes / FKs) */}
            {activeConnectionId && activeTable && (
              <TableSchemaSection
                connectionId={activeConnectionId}
                tableName={activeTable}
                schema={connData?.activeSchema ?? null}
              />
            )}
          </div>
        )}
      </div>
    </aside>
  );
};

const Section = ({ children }: { children: ReactNode }) => (
  <div className="space-y-2">{children}</div>
);

const SectionLabel = ({
  children,
  icon: Icon,
}: {
  children: ReactNode;
  icon?: typeof Sliders;
}) => (
  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted font-medium pb-1 border-b border-subtle">
    {Icon && <Icon size={10} />}
    <span>{children}</span>
  </div>
);

interface RowProps {
  label: string;
  value: string;
  accent?: boolean;
  badge?: 'success' | 'muted';
}

const Row = ({ label, value, accent, badge }: RowProps) => (
  <div className="flex items-baseline justify-between gap-3 text-xs leading-snug">
    <span className="text-muted shrink-0">{label}</span>
    {badge ? (
      <span
        className={clsx(
          'px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium',
          badge === 'success'
            ? 'bg-success-bg text-success-text'
            : 'bg-surface-secondary text-muted',
        )}
      >
        {value}
      </span>
    ) : (
      <span
        className={clsx(
          'font-mono truncate text-right',
          accent ? 'text-primary' : 'text-secondary',
        )}
      >
        {value}
      </span>
    )}
  </div>
);

const EmptyState = ({ message }: { message: string }) => (
  <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12 text-muted">
    <Sliders size={28} className="opacity-40 mb-3" />
    <span className="text-xs">{message}</span>
  </div>
);
