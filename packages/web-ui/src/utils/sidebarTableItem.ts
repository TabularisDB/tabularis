/**
 * Memoization helpers for the sidebar table item.
 *
 * `SidebarTableItem` is rendered once per table and the sidebar re-renders
 * frequently (e.g. when `activeTable` changes after selecting a Quick
 * Navigator result). With hundreds of tables, re-rendering every item on each
 * change makes the UI unresponsive. The comparator below lets `React.memo`
 * skip items whose meaningful data hasn't changed, so switching the active
 * table only re-renders the two affected items instead of all of them.
 */

import type { DriverCapabilities } from "../types/plugins";

/** Subset of the table item props that actually affect its rendered output. */
export interface TableItemComparableProps {
  table: { name: string };
  activeTable: string | null;
  connectionId: string;
  driver: string;
  /** Drives identifier quoting in the nested `SidebarColumnItem` (issue
   * #614) — must be compared, or a capabilities-only update (e.g. the
   * driver's manifest finishes resolving after mount) would be silently
   * skipped by memo and the item would keep quoting as if no capabilities
   * were available. */
  capabilities?: DriverCapabilities | null;
  canManage?: boolean;
  schemaVersion: number;
  schema?: string;
}

/**
 * Returns true when two sets of table-item props are equivalent for rendering.
 *
 * Callback identity is intentionally ignored: the handlers are recreated on
 * every parent render but behave the same, and any captured value that matters
 * (connection / driver) is part of the comparison. Rather than comparing
 * `activeTable` directly — which is the same global value for every item and so
 * changes for all of them at once — we compare whether *this* item is the
 * active one, which only flips for the item gaining and the item losing focus.
 */
export function areTableItemPropsEqual(
  prev: TableItemComparableProps,
  next: TableItemComparableProps,
): boolean {
  const wasActive = prev.activeTable === prev.table.name;
  const isActive = next.activeTable === next.table.name;
  return (
    prev.table.name === next.table.name &&
    wasActive === isActive &&
    prev.connectionId === next.connectionId &&
    prev.driver === next.driver &&
    prev.capabilities === next.capabilities &&
    prev.canManage === next.canManage &&
    prev.schemaVersion === next.schemaVersion &&
    prev.schema === next.schema
  );
}

/** Escape a string for safe use inside a double-quoted CSS attribute selector. */
function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Builds the CSS selector that matches a sidebar table item's outer element.
 *
 * Must stay in sync with the `data-table-name` / `data-schema` attributes set
 * by `SidebarTableItem` (where a missing schema is rendered as an empty
 * string). Values are escaped so table or schema names containing quotes or
 * backslashes don't produce an invalid selector.
 */
export function buildTableItemSelector(
  tableName: string,
  schema?: string | null,
): string {
  const name = escapeAttributeValue(tableName);
  const sch = escapeAttributeValue(schema ?? "");
  return `[data-table-name="${name}"][data-schema="${sch}"]`;
}
