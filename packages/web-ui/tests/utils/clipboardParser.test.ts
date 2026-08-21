import { describe, it, expect } from 'vitest';
import { parseClipboardText, reParseWithHeaderOption } from '../../src/utils/clipboardParser';

describe('detectFormat', () => {
  it('detects TSV from tab-separated content', () => {
    const result = parseClipboardText('name\tage\tCity\nAlice\t30\tRome\nBob\t25\tMilan');
    expect(result.format).toBe('tsv');
  });

  it('detects JSON array', () => {
    const result = parseClipboardText('[{"name":"Alice","age":30},{"name":"Bob","age":25}]');
    expect(result.format).toBe('json-array');
  });

  it('detects CSV', () => {
    const result = parseClipboardText('name,age,city\nAlice,30,Rome\nBob,25,Milan');
    expect(result.format).toBe('csv');
  });

  it('detects Markdown table', () => {
    const md = '| name | age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |';
    const result = parseClipboardText(md);
    expect(result.format).toBe('markdown-table');
  });
});

describe('TSV parsing', () => {
  it('extracts headers and rows correctly', () => {
    const result = parseClipboardText('name\tage\nAlice\t30\nBob\t25');
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['Alice', '30']);
    expect(result.rowCount).toBe(2);
    expect(result.hasHeaderRow).toBe(true);
  });

  it('sanitizes column names with special chars', () => {
    const result = parseClipboardText('First Name\tDate of Birth\nAlice\t1990-01-01');
    expect(result.headers[0]).toBe('first_name');
    expect(result.headers[1]).toBe('date_of_birth');
  });

  it('deduplicates column names', () => {
    const result = parseClipboardText('id\tid\tid\n1\t2\t3');
    expect(result.headers).toEqual(['id', 'id_1', 'id_2']);
  });
});

describe('JSON parsing', () => {
  it('extracts keys as headers', () => {
    const json = '[{"id":1,"email":"a@b.com"},{"id":2,"email":"c@d.com"}]';
    const result = parseClipboardText(json);
    expect(result.headers).toEqual(['id', 'email']);
    expect(result.rows).toHaveLength(2);
    expect(result.hasHeaderRow).toBe(false);
  });

  it('handles single JSON object', () => {
    const result = parseClipboardText('{"name":"Alice","age":30}');
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.rows).toHaveLength(1);
  });

  it('serializes nested objects to JSON string', () => {
    const result = parseClipboardText('[{"id":1,"meta":{"key":"val"}}]');
    expect(result.rows[0][1]).toBe('{"key":"val"}');
  });
});

describe('CSV parsing', () => {
  it('parses comma-separated values', () => {
    const result = parseClipboardText('name,age\nAlice,30\nBob,25');
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.rows).toHaveLength(2);
  });

  it('handles quoted fields with commas', () => {
    const result = parseClipboardText('name,address\nAlice,"Rome, Italy"\nBob,"Milan, Italy"');
    expect(result.rows[0][1]).toBe('Rome, Italy');
  });

  it('handles semicolon separator', () => {
    const result = parseClipboardText('name;age\nAlice;30\nBob;25');
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.rows[0]).toEqual(['Alice', '30']);
  });
});

describe('Markdown table parsing', () => {
  it('parses header and data rows, skipping separator', () => {
    const md = '| id | name | city |\n|---|---|---|\n| 1 | Alice | Rome |\n| 2 | Bob | Milan |';
    const result = parseClipboardText(md);
    expect(result.headers).toEqual(['id', 'name', 'city']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['1', 'Alice', 'Rome']);
  });
});

describe('Type inference', () => {
  it('infers INTEGER for integer columns', () => {
    const result = parseClipboardText('id\tcount\n1\t100\n2\t200');
    const idCol = result.inferredColumns.find((c) => c.name === 'id');
    expect(idCol?.sqlType).toBe('INTEGER');
    expect(idCol?.confidence).toBe('high');
  });

  it('infers REAL for decimal columns', () => {
    const result = parseClipboardText('price\n1.99\n29.99\n0.50');
    expect(result.inferredColumns[0].sqlType).toBe('REAL');
  });

  it('infers BOOLEAN for boolean columns', () => {
    const result = parseClipboardText('active\ntrue\nfalse\ntrue');
    expect(result.inferredColumns[0].sqlType).toBe('BOOLEAN');
  });

  it('infers DATE for date columns', () => {
    const result = parseClipboardText('created_at\n2024-01-01\n2024-06-15\n2024-12-31');
    expect(result.inferredColumns[0].sqlType).toBe('DATE');
  });

  it('infers DATETIME for datetime columns', () => {
    const result = parseClipboardText('created_at\n2024-01-01T10:00:00\n2024-06-15 12:30:00');
    expect(result.inferredColumns[0].sqlType).toBe('DATETIME');
  });

  it('defaults to TEXT for mixed types with low confidence', () => {
    const result = parseClipboardText('value\n123\nhello\n456');
    const col = result.inferredColumns[0];
    expect(col.sqlType).toBe('TEXT');
    expect(col.confidence).toBe('low');
  });

  it('promotes INTEGER+REAL mix to REAL', () => {
    const result = parseClipboardText('amount\n100\n29.99\n50');
    expect(result.inferredColumns[0].sqlType).toBe('REAL');
    expect(result.inferredColumns[0].confidence).toBe('high');
  });

  it('marks column as nullable when many empty values', () => {
    const result = parseClipboardText('name\toptional\nAlice\t\nBob\t\nCarol\t');
    const optCol = result.inferredColumns.find((c) => c.name === 'optional');
    expect(optCol?.nullable).toBe(true);
  });
});

describe('Header detection heuristic', () => {
  it('treats first row as header when values differ from data types', () => {
    const result = parseClipboardText('id\tname\tage\n1\tAlice\t30\n2\tBob\t25');
    expect(result.hasHeaderRow).toBe(true);
  });

  it('treats first row as data when all values match data type', () => {
    const result = parseClipboardText('1\t100\t200\n2\t300\t400\n3\t500\t600');
    expect(result.hasHeaderRow).toBe(false);
  });
});

describe('reParseWithHeaderOption', () => {
  it('re-extracts headers when toggling hasHeaderRow on', () => {
    const original = parseClipboardText('1\t2\n3\t4');
    const reparsed = reParseWithHeaderOption('1\t2\n3\t4', true, original);
    expect(reparsed.headers).toEqual(['1', '2']);
    expect(reparsed.rows).toHaveLength(1);
    expect(reparsed.hasHeaderRow).toBe(true);
  });

  it('generates col_N headers when toggling hasHeaderRow off', () => {
    const original = parseClipboardText('name\tage\nAlice\t30');
    const reparsed = reParseWithHeaderOption('name\tage\nAlice\t30', false, original);
    expect(reparsed.headers).toEqual(['col_1', 'col_2']);
    expect(reparsed.rows).toHaveLength(2);
  });
});

describe('edge cases', () => {
  it('returns empty structure for empty input', () => {
    const result = parseClipboardText('   \n\n  ');
    expect(result.rowCount).toBe(0);
    expect(result.headers).toHaveLength(0);
  });

  it('skips empty rows and adds warning', () => {
    const result = parseClipboardText('name\tage\nAlice\t30\n\n\nBob\t25');
    expect(result.rowCount).toBe(2);
    expect(result.warnings.some((w) => w.includes('empty rows'))).toBe(true);
  });

  it('pads short rows with empty strings', () => {
    const result = parseClipboardText('a\tb\tc\n1\t2');
    expect(result.rows[0]).toHaveLength(3);
    expect(result.rows[0][2]).toBe('');
  });
});
