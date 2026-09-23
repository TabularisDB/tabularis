import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2, Key, Table2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import type { TableTarget } from '../../types/databaseObjects';
import { useTabularisClient } from '../../hooks/useTabularisClient';
import type { TableColumn } from '../../types/editor';

interface SchemaModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: TableTarget;
}

export const SchemaModal = ({ isOpen, onClose, target }: SchemaModalProps) => {
  const client = useTabularisClient();
  const { t } = useTranslation();
  const { connectionId, tableName, schema } = target;
  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [tableComment, setTableComment] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !connectionId || !tableName) return;

    const loadSchema = async () => {
      setLoading(true);
      setError('');
      setTableComment(null);
      try {
        const schemaParam = schema ? { schema } : {};
        const [cols, tables] = await Promise.all([
          client.call('get_columns', {
            connectionId,
            tableName,
            ...schemaParam,
          }),
          client.call('get_tables', {
            connectionId,
            ...schemaParam,
          }),
        ]);
        setColumns(cols);
        setTableComment(
          tables.find((table) => table.name === tableName)?.comment ?? null,
        );
      } catch (err) {
        console.error(err);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    void loadSchema();
  }, [client, isOpen, connectionId, tableName, schema]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100]">
      <div className="bg-elevated rounded-xl shadow-2xl w-[900px] max-w-[90vw] border border-strong flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="bg-accent-primary/15 p-2 rounded-lg">
              <Table2 size={20} className="text-accent" />
            </div>
            <div className="select-text selection:bg-accent-primary! selection:text-inverse!">
              <h2 className="text-lg font-semibold text-primary">{t('schema.title', { table: tableName })}</h2>
              {schema && <p className="text-xs text-secondary font-mono">{schema}</p>}
              {tableComment && (
                <p className="mt-1 max-w-[700px] whitespace-pre-wrap text-xs text-secondary">
                  {tableComment}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40 gap-2 text-muted">
              <Loader2 size={24} className="animate-spin" />
              <span>{t('schema.loading')}</span>
            </div>
          ) : error ? (
            <div className="p-6 text-error-text text-sm text-center">{error}</div>
          ) : (
            <table className="w-full text-left border-collapse select-text selection:bg-accent-primary! selection:text-inverse!">
              <thead className="bg-base sticky top-0">
                <tr>
                  <th className="px-4 py-2.5 text-[10px] uppercase font-bold text-muted border-b border-strong">{t('schema.colName')}</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase font-bold text-muted border-b border-strong">{t('schema.colType')}</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase font-bold text-muted border-b border-strong text-center">{t('schema.colNullable')}</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase font-bold text-muted border-b border-strong text-center">{t('schema.colKey')}</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase font-bold text-muted border-b border-strong">{t('schema.colDescription')}</th>
                </tr>
              </thead>
              <tbody>
                {columns.map(col => (
                  <tr key={col.name} className="border-b border-default hover:bg-surface-secondary/30">
                    <td className="px-4 py-2.5 text-sm text-primary font-mono">{col.name}</td>
                    <td className="px-4 py-2.5 text-sm text-accent font-mono">{col.data_type}</td>
                    <td className="px-4 py-2.5 text-xs text-secondary text-center">
                      {col.is_nullable ? t('schema.yes') : t('schema.no')}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {col.is_pk && <Key size={14} className="text-semantic-pk mx-auto" />}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-secondary whitespace-pre-wrap max-w-[320px]">
                      {col.comment || <span className="text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm">
            {t('schema.close', { defaultValue: 'Close' })}
          </button>
        </div>
      </div>
    </Modal>
  );
};
