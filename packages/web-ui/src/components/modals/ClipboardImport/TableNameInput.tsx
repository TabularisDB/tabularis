import { Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface TableNameInputProps {
  value: string;
  onChange: (value: string) => void;
  tableExists: boolean;
  aiEnabled: boolean;
  aiLoading: boolean;
  onAiSuggest: () => void;
}

export function TableNameInput({
  value,
  onChange,
  tableExists,
  aiEnabled,
  aiLoading,
  onAiSuggest,
}: TableNameInputProps) {
  const { t } = useTranslation();

  return (
    <div>
      <label className="block text-xs uppercase font-bold text-muted mb-1">
        {t('clipboardImport.tableName')}
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('clipboardImport.tableNamePlaceholder')}
            className={`w-full bg-base border rounded-lg px-3 py-2 text-primary focus:outline-none transition-all font-mono text-sm ${
              tableExists ? 'border-yellow-500/60 focus:border-yellow-500' : 'border-strong focus:border-blue-500'
            }`}
            autoFocus
          />
          {tableExists && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-yellow-400 text-[10px]">
              <AlertTriangle size={12} />
              <span>{t('clipboardImport.tableExists')}</span>
            </div>
          )}
        </div>
        {aiEnabled && (
          <button
            onClick={onAiSuggest}
            disabled={aiLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs bg-purple-900/30 hover:bg-purple-900/50 border border-purple-800/40 text-purple-300 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
            title={t('clipboardImport.aiSuggest')}
          >
            {aiLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            {t('clipboardImport.aiSuggest')}
          </button>
        )}
      </div>
    </div>
  );
}
