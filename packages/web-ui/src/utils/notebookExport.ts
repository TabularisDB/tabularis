import type { QueryResult } from "../types/editor";

export function resultToCsv(result: QueryResult): string {
  const escapeCsvField = (value: unknown): string => {
    const str = value === null || value === undefined ? "" : String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = result.columns.map(escapeCsvField).join(",");
  const rows = result.rows.map((row) =>
    row.map(escapeCsvField).join(","),
  );
  return [header, ...rows].join("\n");
}

export function resultToJson(result: QueryResult): string {
  const objects = result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}
