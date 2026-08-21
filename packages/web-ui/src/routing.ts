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
} as const;

export const BROWSER_ROUTE_PATHS = Object.values(BROWSER_ROUTES);
