import type { QueryResult } from "../types/editor";
import type { CellChartConfig, ChartType } from "../types/notebook";

export interface ChartDataPoint {
  label: string;
  [key: string]: string | number;
}

export function canRenderChart(result: QueryResult): boolean {
  return result.columns.length >= 2 && result.rows.length > 0;
}

export function getNumericColumns(result: QueryResult): string[] {
  if (result.rows.length === 0) return [];
  return result.columns.filter((_, colIndex) =>
    result.rows.some((row) => typeof row[colIndex] === "number"),
  );
}

export function getLabelColumns(result: QueryResult): string[] {
  if (result.rows.length === 0) return [];
  return result.columns.filter((_, colIndex) =>
    result.rows.some((row) => typeof row[colIndex] === "string"),
  );
}

export function buildDefaultChartConfig(
  result: QueryResult,
): CellChartConfig | null {
  const labelCols = getLabelColumns(result);
  const numericCols = getNumericColumns(result);

  if (labelCols.length === 0 || numericCols.length === 0) return null;

  return {
    type: "bar" as ChartType,
    labelColumn: labelCols[0],
    valueColumns: [numericCols[0]],
  };
}

export function transformResultToChartData(
  result: QueryResult,
  config: CellChartConfig,
): ChartDataPoint[] {
  const labelIdx = result.columns.indexOf(config.labelColumn);
  if (labelIdx === -1) return [];

  const valueIndices = config.valueColumns
    .map((col) => ({ name: col, idx: result.columns.indexOf(col) }))
    .filter((v) => v.idx !== -1);

  if (valueIndices.length === 0) return [];

  return result.rows.map((row) => {
    const point: ChartDataPoint = {
      label: row[labelIdx] != null ? String(row[labelIdx]) : "",
    };
    for (const { name, idx } of valueIndices) {
      const val = row[idx];
      point[name] = typeof val === "number" ? val : Number(val) || 0;
    }
    return point;
  });
}
