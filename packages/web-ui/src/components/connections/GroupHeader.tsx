import type { RefObject } from 'react';
import { GripVertical, ChevronRight, Folder, FolderOpen, MoreVertical, Plus } from 'lucide-react';
import clsx from 'clsx';
import type { ConnectionGroup } from '../../contexts/DatabaseContext';
import { onActivationKey } from '../../utils/keyboardEvents';

export interface GroupHeaderProps {
  group: ConnectionGroup;
  connCount: number;
  isCollapsed: boolean;
  editingGroupId: string | null;
  editGroupName: string;
  isRenameCancelledRef: RefObject<boolean>;
  onToggleCollapse: () => void;
  onOpenContextMenu: (x: number, y: number, groupId: string) => void;
  setEditGroupName: (name: string) => void;
  setEditingGroupId: (id: string | null) => void;
  onRenameConfirm: (groupId: string) => void;
  onGripMouseDown?: (e: React.MouseEvent) => void;
  isDragOver?: boolean;
  onCreateSubgroup?: (groupId: string) => void;
  depth?: number;
}

export const GroupHeader = ({
  group,
  connCount,
  isCollapsed,
  editingGroupId,
  editGroupName,
  isRenameCancelledRef,
  onToggleCollapse,
  onOpenContextMenu,
  setEditGroupName,
  setEditingGroupId,
  onRenameConfirm,
  onGripMouseDown,
  isDragOver,
  onCreateSubgroup,
  depth = 0,
}: GroupHeaderProps) => (
  <div
    role="button"
    tabIndex={0}
    aria-expanded={!isCollapsed}
    className={clsx(
      "flex items-center gap-2 group cursor-pointer rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      isDragOver && "ring-1 ring-accent-primary bg-accent-primary/5"
    )}
    style={{ paddingLeft: depth > 0 ? Math.min(depth, 6) * 20 : 0 }}
    onClick={(e) => {
      // Clicks on the drag grip start a drag, they must not toggle the group.
      if ((e.target as HTMLElement).closest('[data-group-grip]')) return;
      onToggleCollapse();
    }}
    onKeyDown={onActivationKey(onToggleCollapse)}
    onContextMenu={(e) => {
      e.preventDefault();
      onOpenContextMenu(e.clientX, e.clientY, group.id);
    }}
  >
    {onGripMouseDown && (
      <div
        data-group-grip
        aria-hidden="true"
        onMouseDown={onGripMouseDown}
        className="opacity-0 group-hover:opacity-100 cursor-grab p-0.5 rounded text-muted hover:text-secondary shrink-0 select-none"
      >
        <GripVertical size={12} />
      </div>
    )}
    <ChevronRight
      size={14}
      className={clsx('text-muted transition-transform', !isCollapsed && 'rotate-90')}
    />
    {isCollapsed ? (
      <Folder size={16} className="text-accent-warning/70" />
    ) : (
      <FolderOpen size={16} className="text-accent-warning" />
    )}
    {editingGroupId === group.id ? (
      <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
        type="text"
        value={editGroupName}
        onChange={(e) => setEditGroupName(e.target.value)}
        onBlur={() => {
          if (!isRenameCancelledRef.current) onRenameConfirm(group.id);
          isRenameCancelledRef.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onRenameConfirm(group.id);
          if (e.key === 'Escape') {
            isRenameCancelledRef.current = true;
            setEditingGroupId(null);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        autoFocus
        className="px-2 py-0.5 bg-elevated border border-strong rounded text-sm text-primary focus:border-accent-warning/70 focus:outline-none"
      />
    ) : (
      <span className="text-sm font-semibold text-primary">{group.name}</span>
    )}
    <span className="text-xs text-muted">({connCount})</span>
    {onCreateSubgroup && (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onCreateSubgroup(group.id);
        }}
        title="Add subfolder"
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-secondary transition-all"
      >
        <Plus size={12} className="text-accent-warning" />
      </button>
    )}
    <button
      onClick={(e) => {
        e.stopPropagation();
        onOpenContextMenu(e.clientX, e.clientY, group.id);
      }}
      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-secondary transition-all"
    >
      <MoreVertical size={12} className="text-muted" />
    </button>
  </div>
);
