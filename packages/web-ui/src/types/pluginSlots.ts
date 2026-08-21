import type { ComponentType } from "react";

/**
 * All built-in slot locations where plugins can inject UI.
 */
export type SlotName =
  | "row-edit-modal.field.after"
  | "row-edit-modal.footer.before"
  | "row-editor-sidebar.field.after"
  | "row-editor-sidebar.header.actions"
  | "data-grid.toolbar.actions"
  | "data-grid.context-menu.items"
  | "sidebar.footer.actions"
  | "settings.plugin.actions"
  | "settings.plugin.before_settings"
  | "connection-modal.connection_content"
  | "connection-modal.extra_fields";

/**
 * Set of all valid slot names derived from the SlotName union.
 * Single source of truth — import this instead of redefining locally.
 */
export const VALID_SLOTS: ReadonlySet<string> = new Set<SlotName>([
  "row-edit-modal.field.after",
  "row-edit-modal.footer.before",
  "row-editor-sidebar.field.after",
  "row-editor-sidebar.header.actions",
  "data-grid.toolbar.actions",
  "data-grid.context-menu.items",
  "sidebar.footer.actions",
  "settings.plugin.actions",
  "settings.plugin.before_settings",
  "connection-modal.connection_content",
  "connection-modal.extra_fields",
]);

/**
 * Context data provided to every slot component via props.
 */
export interface SlotContext {
  /** Active connection identifier */
  connectionId?: string | null;
  /** Current table name */
  tableName?: string | null;
  /** Active schema name */
  schema?: string | null;
  /** Active driver identifier (e.g. "postgres", "mysql") */
  driver?: string | null;
  /** Current row data (for row-level slots) */
  rowData?: Record<string, unknown>;
  /** Column name (for field-level or context-menu slots) */
  columnName?: string;
  /** Row index (for row-level slots) */
  rowIndex?: number;
  /** Whether the row is a new insertion */
  isInsertion?: boolean;
  /** Plugin identifier for the target plugin (settings slot) */
  targetPluginId?: string;
  /** Arbitrary extra data a host component provides */
  [key: string]: unknown;
}

/**
 * Standard props every slot component receives.
 */
export interface SlotComponentProps {
  /** The slot context data from the host component */
  context: SlotContext;
  /** The plugin that owns this component */
  pluginId: string;
}

/**
 * A UI contribution registered by a plugin.
 */
export interface SlotContribution {
  /** Plugin identifier */
  pluginId: string;
  /** Target slot name */
  slot: SlotName;
  /** React component to render */
  component: ComponentType<SlotComponentProps>;
  /** Ordering weight (lower = earlier). Defaults to 100. */
  order?: number;
  /** Optional predicate to conditionally show the component */
  when?: (context: SlotContext) => boolean;
}

/**
 * Manifest-level UI extension declaration.
 */
export interface UIExtensionDeclaration {
  /** Target slot name */
  slot: SlotName;
  /** Module path relative to the plugin package (e.g. "./ui/MyComponent.tsx") */
  module: string;
  /** Ordering weight */
  order?: number;
  /** If set, the contribution is only active when context.driver matches this value */
  driver?: string;
}
