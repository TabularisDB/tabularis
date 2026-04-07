import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2, Key, Table2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useDatabase } from '../../hooks/useDatabase';
import { Modal } from '../ui/Modal';

interface TableColumn {
  name: string;
  data_type: string;
  is_pk: boolean;
  is_nullable: boolean;
}

interface SchemaModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  schema?: string | null;
}

export const SchemaModal = ({ isOpen, onClose, tableName, schema }: SchemaModalProps) => {
  const { t } = useTranslation();
  const { activeConnectionId, activeSchema } = useDatabase();
  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const resolvedSchema = schema ?? activeSchema;

  useEffect(() => {
    if (!isOpen || !activeConnectionId || !tableName) return;

    const loadSchema = async () => {
      setLoading(true);
      setError('');
      try {
        const cols = await invoke<TableColumn[]>('get_columns', {
          connectionId: activeConnectionId,
          tableName,
          ...(resolvedSchema ? { schema: resolvedSchema } : {}),
        });
        setColumns(cols);
      } catch (err) {
        console.error(err);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    void loadSchema();
  }, [isOpen, activeConnectionId, tableName, resolvedSchema]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100]">
      <div className="bg-elevated rounded-xl shadow-2xl w-[600px] border border-strong flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="bg-blue-900/30 p-2 rounded-lg">
              <Table2 size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">{t('schema.title', { table: tableName })}</h2>
              {resolvedSchema && <p className="text-xs text-secondary font-mono">{resolvedSchema}</p>}
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
            <table className="w-full text-left border-collapse">
              <thead className="bg-base sticky top-0">
                <tr>
                  <th className="px-4 py-2.5 text-[10px] uppercase font-bold text-muted border-b border-strong">{t('schema.colName')}</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase font-bold text-muted border-b border-strong">{t('schema.colType')}</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase font-bold text-muted border-b border-strong text-center">{t('schema.colNullable')}</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase font-bold text-muted border-b border-strong text-center">{t('schema.colKey')}</th>
                </tr>
              </thead>
              <tbody>
                {columns.map(col => (
                  <tr key={col.name} className="border-b border-default hover:bg-surface-secondary/30">
                    <td className="px-4 py-2.5 text-sm text-primary font-mono">{col.name}</td>
                    <td className="px-4 py-2.5 text-sm text-blue-300 font-mono">{col.data_type}</td>
                    <td className="px-4 py-2.5 text-xs text-secondary text-center">
                      {col.is_nullable ? t('schema.yes') : t('schema.no')}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {col.is_pk && <Key size={14} className="text-yellow-500 mx-auto" />}
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
