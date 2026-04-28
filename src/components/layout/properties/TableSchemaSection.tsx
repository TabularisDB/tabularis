import { useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  Key,
  KeyRound,
  Hash,
  AlertCircle,
  Columns3,
  Network,
} from 'lucide-react';
import clsx from 'clsx';
import type { TableColumn, ForeignKey, Index } from '../../../types/schema';

interface Props {
  connectionId: string;
  tableName: string;
  schema?: string | null;
}

interface Metadata {
  columns: TableColumn[];
  foreignKeys: ForeignKey[];
  indexes: Index[];
}

export const TableSchemaSection = ({
  connectionId,
  tableName,
  schema,
}: Props) => {
  const { t } = useTranslation();
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setError(null);
    setLoading(true);

    const args: Record<string, unknown> = {
      connectionId,
      tableName,
      ...(schema ? { schema } : {}),
    };

    Promise.all([
      invoke<TableColumn[]>('get_columns', args),
      invoke<ForeignKey[]>('get_foreign_keys', args),
      invoke<Index[]>('get_indexes', args),
    ])
      .then(([cols, fks, idxs]) => {
        if (cancelled) return;
        setMeta({ columns: cols, foreignKeys: fks, indexes: idxs });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connectionId, tableName, schema]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted py-2">
        <Loader2 size={12} className="animate-spin" />
        <span>{t('properties.loadingSchema')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 text-xs text-error-text bg-error-bg border border-error-border rounded px-2 py-1.5">
        <AlertCircle size={12} className="shrink-0 mt-0.5" />
        <span className="truncate">{error}</span>
      </div>
    );
  }

  if (!meta) return null;

  const fkByColumn = new Map<string, ForeignKey>();
  for (const fk of meta.foreignKeys) {
    fkByColumn.set(fk.column_name, fk);
  }

  return (
    <div className="space-y-5">
      <SubSection
        icon={Columns3}
        label={t('properties.columns')}
        count={meta.columns.length}
      >
        {meta.columns.length === 0 ? (
          <Empty>{t('properties.noColumns')}</Empty>
        ) : (
          <ul className="space-y-1">
            {meta.columns.map((col) => {
              const fk = fkByColumn.get(col.name);
              return (
                <li key={col.name} className="group">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {col.is_pk && (
                        <Key
                          size={10}
                          className="text-semantic-pk shrink-0"
                          aria-label="PK"
                        />
                      )}
                      {!col.is_pk && fk && (
                        <KeyRound
                          size={10}
                          className="text-semantic-fk shrink-0"
                          aria-label="FK"
                        />
                      )}
                      <span
                        className={clsx(
                          'font-mono text-xs truncate',
                          col.is_pk ? 'text-primary' : 'text-secondary',
                        )}
                      >
                        {col.name}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-muted shrink-0 truncate">
                      {col.data_type}
                      {col.character_maximum_length
                        ? `(${col.character_maximum_length})`
                        : ''}
                    </span>
                  </div>
                  {(fk || col.is_auto_increment || !col.is_nullable) && (
                    <div className="flex flex-wrap gap-1 mt-0.5 ml-4">
                      {!col.is_nullable && (
                        <Badge tone="warning">NOT NULL</Badge>
                      )}
                      {col.is_auto_increment && (
                        <Badge tone="info">AUTO</Badge>
                      )}
                      {col.default_value !== undefined &&
                        col.default_value !== null && (
                          <Badge tone="muted">
                            = {String(col.default_value)}
                          </Badge>
                        )}
                      {fk && (
                        <Badge tone="fk">
                          → {fk.ref_table}.{fk.ref_column}
                        </Badge>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SubSection>

      {meta.indexes.length > 0 && (
        <SubSection
          icon={Hash}
          label={t('properties.indexes')}
          count={meta.indexes.length}
        >
          <ul className="space-y-1">
            {meta.indexes.map((idx, i) => (
              <li
                key={`${idx.name}-${idx.column_name}-${i}`}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <span className="font-mono text-secondary truncate">
                  {idx.name}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] text-muted font-mono">
                    {idx.column_name}
                  </span>
                  {idx.is_primary && <Badge tone="pk">PK</Badge>}
                  {idx.is_unique && !idx.is_primary && (
                    <Badge tone="info">UNIQUE</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </SubSection>
      )}

      {meta.foreignKeys.length > 0 && (
        <SubSection
          icon={Network}
          label={t('properties.foreignKeys')}
          count={meta.foreignKeys.length}
        >
          <ul className="space-y-1">
            {meta.foreignKeys.map((fk) => (
              <li key={fk.name} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-secondary truncate">
                    {fk.name}
                  </span>
                </div>
                <div className="ml-2 mt-0.5 text-[10px] font-mono text-muted truncate">
                  {fk.column_name} → {fk.ref_table}.{fk.ref_column}
                </div>
              </li>
            ))}
          </ul>
        </SubSection>
      )}
    </div>
  );
};

interface SubSectionProps {
  icon: typeof Hash;
  label: string;
  count?: number;
  children: ReactNode;
}

const SubSection = ({
  icon: Icon,
  label,
  count,
  children,
}: SubSectionProps) => (
  <div className="space-y-2">
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted font-medium pb-1 border-b border-subtle">
      <Icon size={10} />
      <span>{label}</span>
      {count !== undefined && (
        <span className="ml-auto font-mono text-muted">{count}</span>
      )}
    </div>
    {children}
  </div>
);

const Empty = ({ children }: { children: ReactNode }) => (
  <div className="text-[11px] text-muted italic">{children}</div>
);

type BadgeTone = 'pk' | 'fk' | 'info' | 'warning' | 'muted';

const Badge = ({
  children,
  tone,
}: {
  children: ReactNode;
  tone: BadgeTone;
}) => (
  <span
    className={clsx(
      'inline-flex items-center px-1 rounded text-[9px] font-medium tracking-wide font-mono',
      tone === 'pk' && 'bg-amber-500/15 text-semantic-pk',
      tone === 'fk' && 'bg-cyan-500/15 text-semantic-fk',
      tone === 'info' && 'bg-info-bg text-info-text',
      tone === 'warning' && 'bg-warning-bg text-warning-text',
      tone === 'muted' && 'bg-surface-secondary text-muted',
    )}
  >
    {children}
  </span>
);
