import React, { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { useAlert } from "../../../hooks/useAlert";
import { Key, Columns, Edit, Copy, Trash2 } from "lucide-react";
import clsx from "clsx";
import { ContextMenu } from "../../ui/ContextMenu";
import type { TableColumn } from "../../../types/schema";
import { quoteIdentifier, quoteTableRef } from "../../../utils/identifiers";

interface SidebarColumnItemProps {
  column: TableColumn;
  tableName: string;
  connectionId: string;
  driver: string;
  onRefresh: () => void;
  onEdit: (column: TableColumn) => void;
  isView?: boolean;
  schema?: string;
  canManage?: boolean;
}

export const SidebarColumnItem = ({
  column,
  tableName,
  connectionId,
  driver,
  onRefresh,
  onEdit,
  isView = false,
  schema,
  canManage,
}: SidebarColumnItemProps) => {
  const { t } = useLingui();
  const { showAlert } = useAlert();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleDelete = async () => {
    const confirmed = await ask(
      t`Are you sure you want to delete column "${column.name}" from table "${tableName}"?

WARNING: This will permanently delete all data in this column. This action cannot be undone.`,
      { title: t`Delete Column`, kind: "warning" },
    );

    if (confirmed) {
      try {
        const quotedTable = quoteTableRef(tableName, driver, schema);
        const quotedColumn = quoteIdentifier(column.name, driver);
        const query = `ALTER TABLE ${quotedTable} DROP COLUMN ${quotedColumn}`;

        await invoke("execute_query", {
          connectionId,
          query,
          ...(schema ? { schema } : {}),
        });

        onRefresh();
      } catch (e) {
        console.error(e);
        showAlert(t`Failed to delete column: ` + String(e), {
          title: t({ message: "Error", context: "common" }),
          kind: "error",
        });
      }
    }
  };

  return (
    <>
      <div
        className="flex items-center gap-2 px-3 py-1 text-xs text-secondary hover:bg-surface-secondary hover:text-primary cursor-pointer group font-mono"
        onContextMenu={!isView && canManage !== false ? handleContextMenu : undefined}
        onDoubleClick={!isView && canManage !== false ? () => onEdit(column) : undefined}
      >
        {column.is_pk ? (
          <Key size={12} className="text-yellow-500 shrink-0" />
        ) : (
          <Columns size={12} className="text-muted shrink-0" />
        )}
        <span
          className={clsx(
            "truncate flex-1 min-w-0",
            column.is_pk && "font-bold text-yellow-500/80",
          )}
        >
          {column.name}
        </span>
        <span className="text-muted text-[10px] ml-auto shrink-0">
          {column.data_type}
        </span>
      </div>
      {contextMenu && !isView && canManage !== false && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: t({ message: "Modify Column", context: "sidebar" }),
              icon: Edit,
              action: () => onEdit(column),
            },
            {
              label: t`Copy Name`,
              icon: Copy,
              action: () => navigator.clipboard.writeText(column.name),
            },
            {
              label: t`Delete Column`,
              icon: Trash2,
              danger: true,
              action: handleDelete,
            },
          ]}
        />
      )}
    </>
  );
};
