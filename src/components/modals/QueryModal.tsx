import { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import MonacoEditor, { type BeforeMount } from '@monaco-editor/react';
import { useTranslation } from 'react-i18next';
import { useEditorTheme } from '../../hooks/useEditorTheme';
import { loadMonacoTheme } from '../../themes/themeUtils';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';

interface QueryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, sql: string, database?: string | null) => Promise<void>;
  initialName?: string;
  initialSql?: string;
  initialDatabase?: string | null;
  databases?: string[];
  title?: string;
}

export const QueryModal = ({ isOpen, onClose, onSave, initialName = '', initialSql = '', initialDatabase, databases, title = 'Save Query' }: QueryModalProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [sql, setSql] = useState(initialSql);
  const [database, setDatabase] = useState<string | null>(initialDatabase ?? null);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const editorTheme = useEditorTheme();

  const handleBeforeMount: BeforeMount = (monaco) => {
    loadMonacoTheme(editorTheme, monaco);
  };

  useEffect(() => {
    if (isOpen) {
        setName(initialName);
        setSql(initialSql);
        setDatabase(initialDatabase ?? null);
        setError('');
    }
  }, [isOpen, initialName, initialSql, initialDatabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
        setError('Name is required');
        return;
    }
    if (!sql.trim()) {
        setError('SQL content is required');
        return;
    }

    setIsSaving(true);
    try {
        await onSave(name, sql, database);
        onClose();
    } catch (err) {
        setError(String(err));
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-elevated border border-default rounded-xl shadow-2xl w-full max-w-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-secondary hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-base border border-strong rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              placeholder="My Query"
              autoFocus
            />
          </div>

          {databases && databases.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">{t("queryModal.database")}</label>
              <Select
                value={database}
                options={databases}
                onChange={(val) => setDatabase(val)}
                placeholder={t("queryModal.noDatabase")}
                searchable={databases.length > 5}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-secondary mb-1">SQL</label>
            <div className="h-64 w-full border border-strong rounded overflow-hidden">
                <MonacoEditor
                    height="100%"
                    defaultLanguage="sql"
                    theme={editorTheme.id}
                    beforeMount={handleBeforeMount}
                    value={sql}
                    onChange={(val) => setSql(val || '')}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        padding: { top: 8 },
                        wordWrap: 'on',
                    }}
                />
            </div>
          </div>

          {error && <div className="text-red-400 text-sm">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-secondary hover:text-white hover:bg-surface-secondary rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium disabled:opacity-50 transition-colors"
            >
              <Save size={16} />
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
