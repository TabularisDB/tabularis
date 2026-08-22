export const WEB_UI_BASE_PATH = "/";

export const BROWSER_ROUTES = {
  root: "/",
  connections: "/connections",
  editor: "/editor",
  mcp: "/mcp",
  settings: "/settings",
  schemaDiagram: "/schema-diagram",
  taskManager: "/task-manager",
  visualExplain: "/visual-explain",
  jsonViewer: "/json-viewer",
  resultsWindow: "/results-window",
  pluginInstall: "/install/:slug",
} as const;

export const BROWSER_ROUTE_PATHS = Object.values(BROWSER_ROUTES);

export interface SchemaDiagramRouteParams {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly databaseName: string;
  readonly schema?: string;
  readonly focusTable?: string;
}

export function buildConnectionRoute(connectionId: string): string {
  return `${BROWSER_ROUTES.connections}?connect=${encodeURIComponent(connectionId)}&standalone=connection`;
}

export function buildResultsWindowRoute(sessionId: string): string {
  return `${BROWSER_ROUTES.resultsWindow}?session=${encodeURIComponent(sessionId)}`;
}

export function buildSchemaDiagramRoute(
  params: SchemaDiagramRouteParams,
): string {
  const search = new URLSearchParams({
    connectionId: params.connectionId,
    connectionName: params.connectionName,
    databaseName: params.databaseName,
  });
  if (params.schema) search.set("schema", params.schema);
  if (params.focusTable) search.set("focusTable", params.focusTable);
  return `${BROWSER_ROUTES.schemaDiagram}?${search.toString()}`;
}

export function buildVisualExplainRoute(
  connectionId: string,
  query: string,
): string {
  return `${BROWSER_ROUTES.visualExplain}?connection=${encodeURIComponent(
    connectionId,
  )}&query=${base64UrlEncode(query)}`;
}

export function buildRouteWindowLabel(prefix: string, ...parts: string[]): string {
  const suffix = parts
    .join(":")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${prefix}-${suffix}`;
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
