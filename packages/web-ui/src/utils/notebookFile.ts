import type {
  NotebookCell,
  NotebookFile,
  NotebookParam,
} from "../types/notebook";
import { generateCellId } from "./notebook";
import { validateParamName } from "./notebookParams";

/**
 * Keep only well-formed params from an untrusted notebook file: name must be
 * a valid identifier (`\w+`) and value must be a string. Malformed entries
 * are dropped instead of failing the whole import.
 */
function sanitizeParams(raw: unknown): NotebookParam[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const params = raw.filter((p): p is NotebookParam => {
    if (typeof p !== "object" || p === null) return false;
    const { name, value } = p as Record<string, unknown>;
    return (
      typeof name === "string" &&
      validateParamName(name) &&
      typeof value === "string"
    );
  });
  return params.length > 0 ? params : undefined;
}

export function serializeNotebook(
  title: string,
  cells: NotebookCell[],
  params?: NotebookParam[],
  stopOnError?: boolean,
  connectionId?: string,
): NotebookFile {
  return {
    version: 2,
    title,
    createdAt: new Date().toISOString(),
    ...(connectionId ? { connectionId } : {}),
    cells: cells.map((c) => ({
      type: c.type,
      content: c.content,
      ...(c.name ? { name: c.name } : {}),
      ...(c.schema ? { schema: c.schema } : {}),
      ...(c.chartConfig ? { chartConfig: c.chartConfig } : {}),
      ...(c.isParallel ? { isParallel: c.isParallel } : {}),
      ...(c.isCollapsed ? { isCollapsed: c.isCollapsed } : {}),
      ...(c.isQueryCollapsed ? { isQueryCollapsed: c.isQueryCollapsed } : {}),
      ...(c.isResultCollapsed ? { isResultCollapsed: c.isResultCollapsed } : {}),
      ...(c.isChartVisible != null ? { isChartVisible: c.isChartVisible } : {}),
    })),
    ...(params && params.length > 0 ? { params } : {}),
    ...(stopOnError ? { stopOnError } : {}),
  };
}

export function validateNotebookFile(data: unknown): data is NotebookFile {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.version !== "number") return false;
  if (typeof obj.title !== "string") return false;
  if (!Array.isArray(obj.cells)) return false;
  return obj.cells.every(
    (cell: unknown) =>
      typeof cell === "object" &&
      cell !== null &&
      typeof (cell as Record<string, unknown>).type === "string" &&
      ((cell as Record<string, unknown>).type === "sql" ||
        (cell as Record<string, unknown>).type === "markdown") &&
      typeof (cell as Record<string, unknown>).content === "string",
  );
}

export function deserializeNotebook(json: string): {
  title: string;
  cells: NotebookCell[];
  params?: NotebookParam[];
  stopOnError?: boolean;
} {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON");
  }

  if (!validateNotebookFile(data)) {
    throw new Error("Invalid notebook file format");
  }

  const raw = data as unknown as Record<string, unknown>;
  return {
    title: data.title,
    cells: data.cells.map((c) => {
      const cellRaw = c as Record<string, unknown>;
      return {
        id: generateCellId(),
        type: c.type,
        content: c.content,
        name: cellRaw.name as string | undefined,
        schema: c.schema,
        chartConfig: cellRaw.chartConfig as NotebookCell['chartConfig'] ?? null,
        isParallel: cellRaw.isParallel as boolean | undefined,
        isCollapsed: cellRaw.isCollapsed as boolean | undefined,
        isQueryCollapsed: cellRaw.isQueryCollapsed as boolean | undefined,
        isResultCollapsed: cellRaw.isResultCollapsed as boolean | undefined,
        isChartVisible: cellRaw.isChartVisible as boolean | undefined,
        result: null,
        error: undefined,
        executionTime: null,
        isLoading: false,
        isPreview: c.type === "markdown" ? true : undefined,
      };
    }),
    params: sanitizeParams(raw.params),
    stopOnError: typeof raw.stopOnError === "boolean" ? raw.stopOnError : undefined,
  };
}
