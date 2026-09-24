export type ClipboardFormat =
  | 'tsv'
  | 'csv'
  | 'json-array'
  | 'markdown-table'
  | 'unknown';

export type InferredSqlType =
  | 'INTEGER'
  | 'REAL'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATETIME'
  | 'TEXT'
  | 'JSON';

export interface InferredColumn {
  name: string;
  sqlType: InferredSqlType;
  nullable: boolean;
  sampleValues: string[];
  confidence: 'high' | 'low';
}

export interface ParsedClipboardData {
  format: ClipboardFormat;
  headers: string[];
  rows: string[][];
  inferredColumns: InferredColumn[];
  rowCount: number;
  hasHeaderRow: boolean;
  warnings: string[];
}

function detectFormat(text: string): ClipboardFormat {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try { JSON.parse(trimmed); return 'json-array'; } catch { /* not JSON */ }
  }
  const lines = trimmed.split('\n');
  if (
    lines.length >= 2 &&
    lines[0].includes('|') &&
    lines[1].match(/^\s*\|[\s\-:|]+\|\s*$/)
  ) {
    return 'markdown-table';
  }
  if (lines.some((l) => l.includes('\t'))) return 'tsv';
  if (lines.some((l) => l.includes(',') || l.includes(';'))) return 'csv';
  return 'unknown';
}

function parseTsv(text: string): string[][] {
  return text
    .trim()
    .split('\n')
    .map((line) => line.split('\t').map((c) => c.trim()));
}

function parseCsv(text: string): string[][] {
  const firstLine = text.split('\n')[0] ?? '';
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';

  return text
    .trim()
    .split('\n')
    .map((line) => {
      const cells: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
          else inQuotes = !inQuotes;
        } else if (ch === separator && !inQuotes) {
          cells.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      cells.push(current.trim());
      return cells;
    });
}

function parseJsonArray(text: string): { headers: string[]; rows: string[][] } | null {
  try {
    const parsed = JSON.parse(text.trim());
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (arr.length === 0 || typeof arr[0] !== 'object') return null;
    const headers = Object.keys(arr[0]);
    const rows = arr.map((obj: Record<string, unknown>) =>
      headers.map((h) => {
        const v = obj[h];
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      })
    );
    return { headers, rows };
  } catch {
    return null;
  }
}

function parseMarkdown(text: string): string[][] {
  return text
    .trim()
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .filter((l) => !l.match(/^\s*\|[\s\-:|]+\|\s*$/))
    .map((l) =>
      l
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
    );
}

function sanitizeColumnName(name: string, index: number): string {
  const sanitized = name
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toLowerCase();
  return sanitized || `col_${index + 1}`;
}

function deduplicateNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count}`;
  });
}

const INTEGER_RE = /^-?\d+$/;
const REAL_RE = /^-?\d*[.,]\d+$|^-?\d+[eE][+-]?\d+$/;
const BOOL_VALUES = new Set(['true', 'false', 'yes', 'no', '1', '0']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$|^\d{2}-\d{2}-\d{4}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

type RawType = InferredSqlType;

function classifyValue(v: string): RawType {
  const lv = v.toLowerCase();
  if (DATETIME_RE.test(v)) return 'DATETIME';
  if (DATE_RE.test(v)) return 'DATE';
  if (INTEGER_RE.test(v)) return 'INTEGER';
  if (REAL_RE.test(v.replace(',', '.'))) return 'REAL';
  if (BOOL_VALUES.has(lv)) return 'BOOLEAN';
  if ((v.startsWith('{') || v.startsWith('[')) && (() => { try { JSON.parse(v); return true; } catch { return false; } })()) return 'JSON';
  return 'TEXT';
}

function inferType(values: string[]): { type: InferredSqlType; confidence: 'high' | 'low' } {
  const nonEmpty = values.filter((v) => v !== '');
  if (nonEmpty.length === 0) return { type: 'TEXT', confidence: 'low' };

  const types = nonEmpty.map(classifyValue);
  const unique = new Set(types);

  if (unique.size === 1) return { type: types[0], confidence: 'high' };
  if (unique.size === 2 && unique.has('INTEGER') && unique.has('REAL')) return { type: 'REAL', confidence: 'high' };

  return { type: 'TEXT', confidence: 'low' };
}

function isLikelyHeader(firstRow: string[], dataRows: string[][]): boolean {
  if (dataRows.length === 0) return true;
  // If all first-row values are non-numeric strings while data has numerics, likely header
  const sample = dataRows.slice(0, Math.min(5, dataRows.length));
  let headerMatchesDataType = 0;
  firstRow.forEach((h, i) => {
    const colValues = sample.map((r) => r[i] ?? '').filter(Boolean);
    if (colValues.length === 0) return;
    const { type: colType } = inferType(colValues);
    const { type: headerType } = inferType([h]);
    if (colType !== 'TEXT' && headerType === colType) headerMatchesDataType++;
  });
  return headerMatchesDataType < firstRow.length / 2;
}

function normalizeRows(rows: string[][]): string[][] {
  if (rows.length === 0) return rows;
  const maxCols = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => {
    const padded = [...r];
    while (padded.length < maxCols) padded.push('');
    return padded;
  });
}

export function parseClipboardText(text: string): ParsedClipboardData {
  const warnings: string[] = [];
  const format = detectFormat(text);

  let rawRows: string[][] = [];
  let hasHeaderRow = true;
  let presetHeaders: string[] | null = null;

  if (format === 'tsv') {
    rawRows = parseTsv(text);
  } else if (format === 'csv') {
    rawRows = parseCsv(text);
  } else if (format === 'json-array') {
    const result = parseJsonArray(text);
    if (result) {
      presetHeaders = result.headers;
      rawRows = result.rows;
      hasHeaderRow = false;
    }
  } else if (format === 'markdown-table') {
    rawRows = parseMarkdown(text);
  } else {
    rawRows = text.trim().split('\n').map((l) => [l.trim()]);
  }

  const before = rawRows.length;
  rawRows = rawRows.filter((r) => r.some((c) => c.trim() !== ''));
  const skipped = before - rawRows.length;
  if (skipped > 0) warnings.push(`${skipped} empty rows skipped`);

  if (rawRows.length === 0) {
    return { format, headers: [], rows: [], inferredColumns: [], rowCount: 0, hasHeaderRow: false, warnings };
  }

  rawRows = normalizeRows(rawRows);

  let headers: string[];
  let dataRows: string[][];

  if (presetHeaders) {
    headers = deduplicateNames(presetHeaders.map((h, i) => sanitizeColumnName(h, i)));
    dataRows = rawRows;
    hasHeaderRow = false;
  } else {
    const firstRow = rawRows[0];
    const rest = rawRows.slice(1);
    hasHeaderRow = isLikelyHeader(firstRow, rest);

    if (hasHeaderRow) {
      headers = deduplicateNames(firstRow.map((h, i) => sanitizeColumnName(h, i)));
      dataRows = rest;
    } else {
      headers = Array.from({ length: rawRows[0].length }, (_, i) => `col_${i + 1}`);
      dataRows = rawRows;
    }
  }

  const SAMPLE_SIZE = 50;
  const sample = dataRows.slice(0, SAMPLE_SIZE);

  const inferredColumns: InferredColumn[] = headers.map((name, i) => {
    const values = sample.map((r) => r[i] ?? '');
    const nonEmpty = values.filter((v) => v !== '');
    const nullable = values.length > 0 && nonEmpty.length < values.length * 0.8;
    const { type, confidence } = inferType(nonEmpty);
    if (confidence === 'low') {
      warnings.push(`Column "${name}" has mixed types, defaulted to TEXT`);
    }
    return { name, sqlType: type, nullable, sampleValues: nonEmpty.slice(0, 5), confidence };
  });

  return { format, headers, rows: dataRows, inferredColumns, rowCount: dataRows.length, hasHeaderRow, warnings };
}

export function reParseWithHeaderOption(
  text: string,
  hasHeaderRow: boolean,
  existingParsed: ParsedClipboardData,
): ParsedClipboardData {
  const format = existingParsed.format;
  let rawRows: string[][] = [];
  let presetHeaders: string[] | null = null;

  if (format === 'tsv') rawRows = parseTsv(text);
  else if (format === 'csv') rawRows = parseCsv(text);
  else if (format === 'json-array') {
    const result = parseJsonArray(text);
    if (result) { presetHeaders = result.headers; rawRows = result.rows; }
  } else if (format === 'markdown-table') rawRows = parseMarkdown(text);
  else rawRows = text.trim().split('\n').map((l) => [l.trim()]);

  rawRows = rawRows.filter((r) => r.some((c) => c.trim() !== ''));
  if (rawRows.length === 0) return { ...existingParsed, headers: [], rows: [], rowCount: 0 };

  rawRows = normalizeRows(rawRows);

  let headers: string[];
  let dataRows: string[][];

  if (presetHeaders) {
    headers = deduplicateNames(presetHeaders.map((h, i) => sanitizeColumnName(h, i)));
    dataRows = rawRows;
  } else if (hasHeaderRow) {
    headers = deduplicateNames(rawRows[0].map((h, i) => sanitizeColumnName(h, i)));
    dataRows = rawRows.slice(1);
  } else {
    headers = Array.from({ length: rawRows[0].length }, (_, i) => `col_${i + 1}`);
    dataRows = rawRows;
  }

  const SAMPLE_SIZE = 50;
  const sample = dataRows.slice(0, SAMPLE_SIZE);
  const inferredColumns: InferredColumn[] = headers.map((name, i) => {
    const values = sample.map((r) => r[i] ?? '');
    const nonEmpty = values.filter((v) => v !== '');
    const nullable = values.length > 0 && nonEmpty.length < values.length * 0.8;
    const { type, confidence } = inferType(nonEmpty);
    return { name, sqlType: type, nullable, sampleValues: nonEmpty.slice(0, 5), confidence };
  });

  return { ...existingParsed, headers, rows: dataRows, inferredColumns, rowCount: dataRows.length, hasHeaderRow, warnings: existingParsed.warnings };
}
