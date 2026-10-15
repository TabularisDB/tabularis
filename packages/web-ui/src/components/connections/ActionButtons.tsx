import { useTranslation } from 'react-i18next';
import { Power, Edit, Copy, Trash2, ArrowLeftRight } from 'lucide-react';
import clsx from 'clsx';
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

const BUTTON_CLASS = 'p-1.5 rounded-lg text-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/** Hover tints follow the shared tones: primary for edits, success to connect, danger to disconnect/delete. */
const HOVER = {
  primary: 'hover:text-accent hover:bg-accent-primary/10',
  success: 'hover:text-accent-success hover:bg-accent-success/10',
  danger: 'hover:text-accent-error hover:bg-accent-error/10',
};

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
          className={clsx(BUTTON_CLASS, HOVER.primary)}
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
          className={clsx(BUTTON_CLASS, HOVER.danger)}
          title={t('connections.disconnect')}
        >
          <Power size={13} />
        </button>
      ) : (
        <button
          onClick={e => { e.stopPropagation(); if (isDriverEnabled) onConnect(); }}
          disabled={!isDriverEnabled}
          className={clsx(BUTTON_CLASS, HOVER.success)}
          title={isDriverEnabled ? t('connections.connect') : t('connections.pluginDisabled')}
        >
          <Power size={13} />
        </button>
      )}
      <button
        onClick={e => { e.stopPropagation(); if (isDriverEnabled) onEdit(); }}
        disabled={!isDriverEnabled}
        className={clsx(BUTTON_CLASS, HOVER.primary)}
        title={t('connections.edit')}
      >
        <Edit size={13} />
      </button>
      <button
        onClick={e => { e.stopPropagation(); if (isDriverEnabled) onDuplicate(); }}
        disabled={!isDriverEnabled}
        className={clsx(BUTTON_CLASS, HOVER.primary)}
        title={t('connections.clone')}
      >
        <Copy size={13} />
      </button>
      <button
        onClick={e => { e.stopPropagation(); void onDelete(); }}
        className={clsx(BUTTON_CLASS, HOVER.danger)}
        title={t('connections.delete')}
      >
        <Trash2 size={13} />
      </button>
    </>
  );
};
