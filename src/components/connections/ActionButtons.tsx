import { useTranslation } from 'react-i18next';
import { Power, Edit, Copy, Trash2, ArrowLeftRight } from 'lucide-react';
import type { SavedConnection } from '../../contexts/DatabaseContext';
import type { MigrationDirection } from '../../utils/connections';

export interface ActionButtonsProps {
  conn: SavedConnection;
  isOpen: boolean;
  isDriverEnabled: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** "to-plugin" / "to-builtin" shows the migration button; `null` hides it —
   * only relevant during a built-in driver's deprecation window. */
  migrationDirection?: MigrationDirection;
  onMigrate?: () => void;
}

export const ActionButtons = ({
  isOpen, isDriverEnabled, onConnect, onDisconnect, onEdit, onDuplicate, onDelete,
  migrationDirection, onMigrate,
}: ActionButtonsProps) => {
  const { t } = useTranslation();
  return (
    <>
      {migrationDirection && onMigrate && (
        <button
          onClick={e => { e.stopPropagation(); onMigrate(); }}
          className="p-1.5 rounded-lg text-muted hover:text-blue-400 hover:bg-blue-400/10 transition-colors"
          title={
            migrationDirection === 'to-plugin'
              ? t('migration.switchToPlugin')
              : t('migration.switchToBuiltin')
          }
        >
          <ArrowLeftRight size={13} />
        </button>
      )}
      {isOpen ? (
        <button
          onClick={e => { e.stopPropagation(); onDisconnect(); }}
          className="p-1.5 rounded-lg text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
          title={t('connections.disconnect')}
        >
          <Power size={13} />
        </button>
      ) : (
        <button
          onClick={e => { e.stopPropagation(); if (isDriverEnabled) onConnect(); }}
          disabled={!isDriverEnabled}
          className="p-1.5 rounded-lg text-muted hover:text-green-400 hover:bg-green-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={isDriverEnabled ? t('connections.connect') : t('connections.pluginDisabled')}
        >
          <Power size={13} />
        </button>
      )}
      <button
        onClick={e => { e.stopPropagation(); if (isDriverEnabled) onEdit(); }}
        disabled={!isDriverEnabled}
        className="p-1.5 rounded-lg text-muted hover:text-blue-400 hover:bg-blue-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title={t('connections.edit')}
      >
        <Edit size={13} />
      </button>
      <button
        onClick={e => { e.stopPropagation(); if (isDriverEnabled) onDuplicate(); }}
        disabled={!isDriverEnabled}
        className="p-1.5 rounded-lg text-muted hover:text-purple-400 hover:bg-purple-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title={t('connections.clone')}
      >
        <Copy size={13} />
      </button>
      <button
        onClick={e => { e.stopPropagation(); void onDelete(); }}
        className="p-1.5 rounded-lg text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
        title={t('connections.delete')}
      >
        <Trash2 size={13} />
      </button>
    </>
  );
};
