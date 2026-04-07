import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Save, Loader2, AlertTriangle, Link } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { SqlPreview } from '../ui/SqlPreview';
import { useDatabase } from '../../hooks/useDatabase';
import { useDrivers } from '../../hooks/useDrivers';
import { Modal } from '../ui/Modal';
import { supportsCreateForeignKeys, getCapabilitiesForDriver } from '../../utils/driverCapabilities';

interface CreateForeignKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  connectionId: string;
  tableName: string;
  driver: string;
}

interface TableColumn {
    name: string;
}

interface TableInfo {
    name: string;
}

const ON_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'];

export const CreateForeignKeyModal = ({
  isOpen,
  onClose,
  onSuccess,
  connectionId,
  tableName,
  driver
}: CreateForeignKeyModalProps) => {
  const { t } = useTranslation();
  const { activeSchema } = useDatabase();
  const { allDrivers } = useDrivers();
  const canCreateFk = supportsCreateForeignKeys(getCapabilitiesForDriver(driver, allDrivers));
  const [fkName, setFkName] = useState('');
  const [localColumn, setLocalColumn] = useState('');
  const [refTable, setRefTable] = useState('');
  const [refColumn, setRefColumn] = useState('');
  const [onDelete, setOnDelete] = useState('NO ACTION');
  const [onUpdate, setOnUpdate] = useState('NO ACTION');

  const [tables, setTables] = useState<TableInfo[]>([]);
  const [localColumns, setLocalColumns] = useState<TableColumn[]>([]);
  const [refColumns, setRefColumns] = useState<TableColumn[]>([]);

  const [loading, setLoading] = useState(false);
  const [fetchingRefCols, setFetchingRefCols] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
        setFkName(`fk_${tableName}_`);
        setLocalColumn('');
        setRefTable('');
        setRefColumn('');
        setOnDelete('NO ACTION');
        setOnUpdate('NO ACTION');
        setError('');

        const schemaParam = activeSchema ? { schema: activeSchema } : {};
        Promise.all([
            invoke<TableInfo[]>('get_tables', { connectionId, ...schemaParam }),
            invoke<TableColumn[]>('get_columns', { connectionId, tableName, ...schemaParam })
        ]).then(([tbls, cols]) => {
            setTables(tbls);
            setLocalColumns(cols);
            if (cols.length > 0) setLocalColumn(cols[0].name);
            if (tbls.length > 0) setRefTable(tbls[0].name);
        }).catch(e => setError(String(e)));
    }
  }, [isOpen, connectionId, tableName, activeSchema]);

  useEffect(() => {
      if (refTable && isOpen) {
          setFetchingRefCols(true);
          invoke<TableColumn[]>('get_columns', { connectionId, tableName: refTable, ...(activeSchema ? { schema: activeSchema } : {}) })
            .then(cols => {
                setRefColumns(cols);
                if (cols.length > 0) setRefColumn(cols[0].name);
            })
            .catch(e => console.error(e))
            .finally(() => setFetchingRefCols(false));
      }
  }, [refTable, isOpen, connectionId, activeSchema]);

  useEffect(() => {
      if (localColumn && refTable) {
          setFkName(`fk_${tableName}_${refTable}_${localColumn}`);
      }
  }, [localColumn, refTable, tableName]);

  const [sqlPreview, setSqlPreview] = useState('-- ...');

  const generatePreview = useCallback(async () => {
    if (!fkName || !localColumn || !refTable || !refColumn) {
      setSqlPreview('-- ' + t('createFk.sqlPreview'));
      return;
    }
    try {
      const stmts = await invoke<string[]>('get_create_foreign_key_sql', {
        connectionId,
        table: tableName,
        fkName,
        column: localColumn,
        refTable,
        refColumn,
        onDelete,
        onUpdate,
        ...(activeSchema ? { schema: activeSchema } : {}),
      });
      setSqlPreview(stmts.map(s => s + ';').join('\n'));
    } catch (e) {
      setSqlPreview('-- ' + String(e));
    }
  }, [fkName, localColumn, refTable, refColumn, onDelete, onUpdate, connectionId, tableName, activeSchema, t]);

  useEffect(() => {
    const timer = setTimeout(generatePreview, 300);
    return () => clearTimeout(timer);
  }, [generatePreview]);

  const handleCreate = async () => {
      if (!fkName.trim()) { setError(t('createFk.nameRequired')); return; }

      setLoading(true);
      setError('');
      try {
          const stmts = await invoke<string[]>('get_create_foreign_key_sql', {
            connectionId,
            table: tableName,
            fkName,
            column: localColumn,
            refTable,
            refColumn,
            onDelete,
            onUpdate,
            ...(activeSchema ? { schema: activeSchema } : {}),
          });
          for (const sql of stmts) {
            await invoke('execute_query', {
              connectionId,
              query: sql,
              ...(activeSchema ? { schema: activeSchema } : {}),
            });
          }
          onSuccess();
          onClose();
      } catch (e) {
          setError(String(e));
      } finally {
          setLoading(false);
      }
  };

  const selectClass = "w-full bg-base border border-strong rounded-lg px-3 py-2 text-primary text-sm focus:border-blue-500 focus:outline-none appearance-none cursor-pointer hover:bg-elevated transition-colors";
  const selectStyle = {
    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
    backgroundPosition: `right 0.5rem center`,
    backgroundRepeat: `no-repeat`,
    backgroundSize: `1.5em 1.5em`,
    paddingRight: `2.5rem`
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100]">
      <div className="bg-elevated rounded-xl shadow-2xl w-[600px] border border-strong flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="bg-purple-900/30 p-2 rounded-lg">
              <Link size={20} className="text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">{t('createFk.title')}</h2>
              <p className="text-xs text-secondary font-mono">{tableName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-4 overflow-y-auto">
            {!canCreateFk && (
                <div className="bg-warning-bg border border-warning-border text-warning-text text-xs p-3 rounded-lg flex items-start gap-2">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>{t('sidebar.sqliteFkError')}</span>
                </div>
            )}

            <div>
                <label className="block text-xs uppercase font-bold text-muted mb-1">{t('createFk.name')}</label>
                <input
                    value={fkName}
                    onChange={(e) => { setFkName(e.target.value); setError(''); }}
                    className={`w-full bg-base border rounded-lg px-3 py-2 text-primary text-sm focus:border-blue-500 focus:outline-none font-mono ${!fkName.trim() && error ? 'border-red-500' : 'border-strong'}`}
                />
            </div>

            {/* Column mapping */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs uppercase font-bold text-muted mb-1">{t('createFk.column')}</label>
                    <select value={localColumn} onChange={(e) => setLocalColumn(e.target.value)} className={selectClass} style={selectStyle}>
                        {localColumns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs uppercase font-bold text-muted mb-1">{t('createFk.refTable')}</label>
                    <select value={refTable} onChange={(e) => setRefTable(e.target.value)} className={selectClass} style={selectStyle}>
                        {tables.map(t_info => <option key={t_info.name} value={t_info.name}>{t_info.name}</option>)}
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div></div>
                <div>
                    <label className="block text-xs uppercase font-bold text-muted mb-1">{t('createFk.refColumn')}</label>
                    {fetchingRefCols ? (
                        <div className="text-xs text-muted flex items-center gap-2 py-2"><Loader2 size={12} className="animate-spin"/> {t('common.loading')}</div>
                    ) : (
                        <select value={refColumn} onChange={(e) => setRefColumn(e.target.value)} className={selectClass} style={selectStyle}>
                            {refColumns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                        </select>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs uppercase font-bold text-muted mb-1">{t('createFk.onUpdate')}</label>
                    <select value={onUpdate} onChange={(e) => setOnUpdate(e.target.value)} className={selectClass} style={selectStyle}>
                        {ON_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs uppercase font-bold text-muted mb-1">{t('createFk.onDelete')}</label>
                    <select value={onDelete} onChange={(e) => setOnDelete(e.target.value)} className={selectClass} style={selectStyle}>
                        {ON_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                </div>
            </div>

            {/* SQL Preview */}
            <div>
                <div className="text-[10px] text-muted mb-1 uppercase tracking-wider">{t('createFk.sqlPreview')}</div>
                <SqlPreview sql={sqlPreview} height="80px" showLineNumbers={true} />
            </div>

            {error && (
                <div className="text-error-text text-xs bg-error-bg border border-error-border p-3 rounded-lg flex items-center gap-2">
                    <AlertTriangle size={14} className="shrink-0" />
                    {error}
                </div>
            )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
           <button onClick={onClose} className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm">
             {t('createFk.cancel')}
           </button>
           <button
             onClick={handleCreate}
             disabled={loading || !canCreateFk || !fkName.trim()}
             className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-medium text-sm flex items-center gap-2 shadow-lg shadow-blue-900/20 transition-all"
           >
             {loading && <Loader2 size={16} className="animate-spin" />}
             <Save size={16} /> {t('createFk.create')}
           </button>
        </div>
      </div>
    </Modal>
  );
};
