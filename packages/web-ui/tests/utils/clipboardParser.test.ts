import {describe, it, expect} from 'vitest';
import {parseClipboardText, reParseWithHeaderOption} from '@/utils/clipboardParser';

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
    it.each([',', ';'])('keeps multiline quoted fields with separator %s', (separator) => {
        const text = `id${separator}note\n1${separator}"first\nsecond"\n2${separator}plain`;
        const result = parseClipboardText(text);
        expect(result.rows).toEqual([
            ['1', 'first\nsecond'],
            ['2', 'plain'],
        ]);
        expect(result.rowCount).toBe(2);
        expect(reParseWithHeaderOption(text, false, result).rows).toEqual([
            ['id', 'note'],
            ['1', 'first\nsecond'],
            ['2', 'plain'],
        ]);
    });

    it('keeps escaped quotes and CRLF inside quoted cells', () => {
        const result = parseClipboardText('id,note\r\n1,"first ""quoted""\r\nsecond"\r\n2,end\r\n');
        expect(result.rows).toEqual([
            ['1', 'first "quoted"\r\nsecond'],
            ['2', 'end'],
        ]);
    });

    it('retains empty trailing cells after multiline fields', () => {
        const result = parseClipboardText('id,note,extra\n1,"first\nsecond",');
        expect(result.rows).toEqual([['1', 'first\nsecond', '']]);
    });

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

describe('file format hints', () => {
    it('keeps a quoted tab in a CSV cell', () => {
        expect(parseClipboardText('id,note\n1,"left\tright"', 'csv').rows).toEqual([
            ['1', 'left\tright'],
        ]);
    });
    it('ignores separators inside quoted headers when choosing CSV delimiter', () => {
        const result = parseClipboardText('"comma,header";note\n1;value', 'csv');
        expect(result.rows).toEqual([['1', 'value']]);
    });
    it('normalizes a large row count without exceeding the argument limit', () => {
        const result = parseClipboardText('id,value\n' + '1,a\n'.repeat(150000), 'csv');
        expect(result.rowCount).toBe(150000);
        expect(result.rows[149999]).toEqual(['1', 'a']);
    });
});

describe('cells copied from a spreadsheet', () => {
    it('keeps a quoted cell with a line break in one cell', () => {
        const result = parseClipboardText('name\tnote\nAlice\t"line 1\nline 2"\nBob\tok');
        expect(result.rows).toEqual([
            ['Alice', 'line 1\nline 2'],
            ['Bob', 'ok'],
        ]);
    });

    it('reads doubled quotes and tabs inside a quoted cell', () => {
        const result = parseClipboardText('a\tb\n"say ""hi""\tthere"\tx');
        expect(result.rows).toEqual([['say "hi"\tthere', 'x']]);
    });

    it('keeps CRLF line breaks inside and between quoted cells', () => {
        const result = parseClipboardText('a\tb\r\n"one\r\ntwo"\tx\r\ny\tz');
        expect(result.rows).toEqual([
            ['one\r\ntwo', 'x'],
            ['y', 'z'],
        ]);
    });

    it('keeps an empty first cell so the first row stays aligned', () => {
        const text = '\tname\tage\n1\tAlice\t30\n2\tBob\t41';
        const result = parseClipboardText(text);
        expect(result.headers.slice(1)).toEqual(['name', 'age']);
        expect(result.rows).toEqual([
            ['1', 'Alice', '30'],
            ['2', 'Bob', '41'],
        ]);

        const reparsed = reParseWithHeaderOption(text, false, result);
        expect(reparsed.rows[0]).toEqual(['', 'name', 'age']);
    });

    it('still ignores line breaks around the copied range', () => {
        const result = parseClipboardText('\r\nname\tage\r\nAlice\t30\r\n');
        expect(result.headers).toEqual(['name', 'age']);
        expect(result.rows).toEqual([['Alice', '30']]);
    });

    it('treats a quote that does not wrap the whole cell as text', () => {
        const result = parseClipboardText('size\tlabel\n5"\t"quoted" text\n6"\tplain');
        expect(result.rows).toEqual([
            ['5"', '"quoted" text'],
            ['6"', 'plain'],
        ]);
    });
});

describe('leading zeros', () => {
    it('infers TEXT for codes with leading zeros, so they are kept', () => {
        const result = parseClipboardText(
            'zip\tphone\tid\n00123\t0612345678\t1\n02134\t0698765432\t2',
        );
        const type = (name: string) => result.inferredColumns.find((c) => c.name === name)?.sqlType;
        expect(type('zip')).toBe('TEXT');
        expect(type('phone')).toBe('TEXT');
        expect(type('id')).toBe('INTEGER');
    });

    it('keeps zero itself and decimals below one numeric', () => {
        const result = parseClipboardText('n\tr\n0\t0.5\n10\t1.25');
        const type = (name: string) => result.inferredColumns.find((c) => c.name === name)?.sqlType;
        expect(type('n')).toBe('INTEGER');
        expect(type('r')).toBe('REAL');
    });
});
