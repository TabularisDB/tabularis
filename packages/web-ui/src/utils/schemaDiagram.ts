/**
 * Schema Diagram utilities
 * Extracted from SchemaDiagramPage.tsx for testability
 */

/**
 * Connection parameters parsed from URL
 */
export interface ConnectionParams {
  connectionId: string | null;
  connectionName: string;
  databaseName: string;
}

/**
 * Parse connection parameters from URL search params
 * @param searchParams - URLSearchParams from React Router
 * @returns Parsed connection parameters
 */
export function parseConnectionParams(searchParams: URLSearchParams): ConnectionParams {
  return {
    connectionId: searchParams.get('connectionId'),
    connectionName: searchParams.get('connectionName') || 'Unknown',
    databaseName: searchParams.get('databaseName') || 'Unknown',
  };
}

/**
 * Resolve the `schema` argument sent to the backend when loading a diagram.
 *
 * The backend uses this value to decide which database/schema to snapshot. The
 * MySQL/MariaDB driver treats it as the database name and falls back to the
 * connection's primary database when it is absent — so on a single connection
 * that exposes multiple databases, omitting it would always snapshot the first
 * database. When no explicit schema is provided, fall back to the selected
 * database name. PostgreSQL always provides an explicit schema, so its behaviour
 * is unchanged.
 *
 * @param schema - Explicit schema from the URL (PostgreSQL), if any
 * @param databaseName - The selected database name (may be the 'Unknown' sentinel)
 * @returns The schema/database to request, or undefined to use the backend default
 */
export function resolveDiagramSchema(
  schema: string | undefined,
  databaseName: string | undefined,
): string | undefined {
  if (schema) return schema;
  if (databaseName && databaseName !== 'Unknown') return databaseName;
  return undefined;
}

/**
 * Format a diagram title from database and connection names
 * @param databaseName - Name of the database
 * @param connectionName - Name of the connection
 * @returns Formatted title string
 */
export function formatDiagramTitle(databaseName: string, connectionName: string): string {
  return `${databaseName} (${connectionName})`;
}

/**
 * Check if fullscreen is currently active
 * @returns True if document is in fullscreen mode
 */
export function isFullscreenActive(): boolean {
  if (typeof document === 'undefined') return false;
  return !!document.fullscreenElement;
}

/**
 * Request fullscreen mode for the document
 * @returns Promise that resolves when fullscreen is entered
 */
export async function enterFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return;

  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen();
  }
}

/**
 * Exit fullscreen mode
 * @returns Promise that resolves when fullscreen is exited
 */
export async function exitFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return;

  if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
}

/**
 * Toggle fullscreen mode
 * @returns Promise that resolves when toggle is complete
 */
export async function toggleFullscreen(): Promise<void> {
  if (isFullscreenActive()) {
    await exitFullscreen();
  } else {
    await enterFullscreen();
  }
}

/**
 * Determine if minimap should be shown based on table count
 * @param tableCount - Number of tables in the diagram
 * @returns True if minimap should be displayed
 */
export function shouldShowMinimap(tableCount: number): boolean {
  // Show minimap for medium-sized schemas (10-100 tables)
  return tableCount >= 10 && tableCount <= 100;
}

/**
 * Determine if edge animations should be enabled based on edge count
 * @param edgeCount - Number of edges (relationships) in the diagram
 * @returns True if animations should be enabled
 */
export function shouldAnimateEdges(edgeCount: number): boolean {
  // Only animate first 50 edges to prevent performance issues
  return edgeCount <= 50;
}
