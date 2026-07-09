import type { RefObject } from 'react';
import { GripVertical, ChevronRight, Folder, FolderOpen, MoreVertical, Plus } from 'lucide-react';
import clsx from 'clsx';
import type { ConnectionGroup } from '../../contexts/DatabaseContext';

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
    className={clsx(
      "flex items-center gap-2 group cursor-pointer rounded-lg",
      isDragOver && "ring-1 ring-blue-400 bg-blue-500/5"
    )}
    style={{ paddingLeft: depth > 0 ? Math.min(depth, 6) * 20 : 0 }}
    onClick={onToggleCollapse}
    onContextMenu={(e) => {
      e.preventDefault();
      onOpenContextMenu(e.clientX, e.clientY, group.id);
    }}
  >
    {onGripMouseDown && (
      <div
        onMouseDown={onGripMouseDown}
        onClick={(e) => e.stopPropagation()}
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
      <Folder size={16} className="text-amber-400/70" />
    ) : (
      <FolderOpen size={16} className="text-amber-400" />
    )}
    {editingGroupId === group.id ? (
      <input
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
        className="px-2 py-0.5 bg-elevated border border-strong rounded text-sm text-primary focus:border-amber-500/70 focus:outline-none"
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
        <Plus size={12} className="text-amber-400" />
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
