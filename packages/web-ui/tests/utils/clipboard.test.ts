import {describe, it, expect, vi, beforeEach} from 'vitest';
import {GOOGLESQL_CAPS} from '../../../../tests/fixtures/sql-syntax/googlesql';
import {
    rowToCSV,
    rowsToCSV,
    rowsToCSVWithHeaders,
    rowToJSON,
    rowsToJSON,
    columnValuesForCopy,
    columnValuesToInClause,
    getSelectedRows,
    copyTextToClipboard,
    rowsToHtmlTable,
    columnNamesAsLines,
    columnNamesAsJson,
    formatRowsForCopy,
    rowsToSqlInsert,
    rowsToSqlUpdate,
    sqlUpdateBlocker,
    rowsToMarkdown,
} from '@/utils/clipboard';
import type {DriverCapabilities} from '@/types/plugins';

describe('clipboard utils', () => {
    describe('rowToCSV', () => {
        it('should convert a simple row with default comma delimiter', () => {
            const row = [1, 'test', true];
            expect(rowToCSV(row)).toBe('1,test,true');
        });

        it('should handle null values with default label', () => {
            const row = [1, null, 'test'];
            expect(rowToCSV(row)).toBe('1,null,test');
        });

        it('should handle null values with custom label', () => {
            const row = [1, null, 'test'];
            expect(rowToCSV(row, 'NULL')).toBe('1,NULL,test');
        });

        it('should handle undefined values', () => {
            const row = [1, undefined, 'test'];
            expect(rowToCSV(row)).toBe('1,null,test');
        });

        it('should handle empty row', () => {
            const row: unknown[] = [];
            expect(rowToCSV(row)).toBe('');
        });

        it('should handle objects by converting to JSON', () => {
            const row = [1, {name: 'test'}, 'value'];
            // The JSON text has quotes, so the CSV field is quoted with them doubled.
            expect(rowToCSV(row)).toBe('1,"{""name"":""test""}",value');
        });

        it('should handle boolean values', () => {
            const row = [true, false, null];
            expect(rowToCSV(row)).toBe('true,false,null');
        });

        it('should use tab delimiter', () => {
            const row = [1, 'test', true];
            expect(rowToCSV(row, 'null', '\t')).toBe('1\ttest\ttrue');
        });

        it('should use semicolon delimiter', () => {
            const row = [1, 'test', true];
            expect(rowToCSV(row, 'null', ';')).toBe('1;test;true');
        });

        it('should use pipe delimiter', () => {
            const row = [1, 'test', true];
            expect(rowToCSV(row, 'null', '|')).toBe('1|test|true');
        });
    });

    describe('rowsToCSV', () => {
        it('should convert multiple rows with default comma delimiter', () => {
            const rows = [
                [1, 'Alice', 25],
                [2, 'Bob', 30],
                [3, 'Charlie', 35],
            ];
            expect(rowsToCSV(rows)).toBe('1,Alice,25\n2,Bob,30\n3,Charlie,35');
        });

        it('should handle null values in multiple rows', () => {
            const rows = [
                [1, null, 'test'],
                [2, 'value', null],
            ];
            expect(rowsToCSV(rows)).toBe('1,null,test\n2,value,null');
        });

        it('should handle empty rows array', () => {
            const rows: unknown[][] = [];
            expect(rowsToCSV(rows)).toBe('');
        });

        it('should handle single row', () => {
            const rows = [[1, 'test', true]];
            expect(rowsToCSV(rows)).toBe('1,test,true');
        });

        it('should use custom null label', () => {
            const rows = [
                [1, null],
                [2, 'value'],
            ];
            expect(rowsToCSV(rows, 'NULL')).toBe('1,NULL\n2,value');
        });

        it('should use semicolon delimiter', () => {
            const rows = [
                [1, 'Alice'],
                [2, 'Bob'],
            ];
            expect(rowsToCSV(rows, 'null', ';')).toBe('1;Alice\n2;Bob');
        });

        it('should use tab delimiter', () => {
            const rows = [
                [1, 'Alice'],
                [2, 'Bob'],
            ];
            expect(rowsToCSV(rows, 'null', '\t')).toBe('1\tAlice\n2\tBob');
        });
    });

    describe('rowToJSON', () => {
        it('should convert a row to a JSON object string', () => {
            const row = [1, 'John Doe', 'john@example.com'];
            const columns = ['id', 'name', 'email'];
            expect(rowToJSON(row, columns)).toBe(
                '{"id":1,"name":"John Doe","email":"john@example.com"}',
            );
        });

        it('should handle null values', () => {
            const row = [1, null, 'test'];
            const columns = ['id', 'name', 'value'];
            expect(rowToJSON(row, columns)).toBe('{"id":1,"name":null,"value":"test"}');
        });

        it('should handle undefined values as null', () => {
            const row = [1, undefined];
            const columns = ['id', 'name'];
            expect(rowToJSON(row, columns)).toBe('{"id":1,"name":null}');
        });

        it('should handle boolean values', () => {
            const row = [true, false];
            const columns = ['active', 'deleted'];
            expect(rowToJSON(row, columns)).toBe('{"active":true,"deleted":false}');
        });

        it('should handle object values', () => {
            const row = [1, {nested: 'value'}];
            const columns = ['id', 'data'];
            expect(rowToJSON(row, columns)).toBe('{"id":1,"data":{"nested":"value"}}');
        });

        it('should handle empty row', () => {
            expect(rowToJSON([], [])).toBe('{}');
        });
    });

    describe('rowsToJSON', () => {
        it('should convert multiple rows to a JSON array string', () => {
            const rows = [
                [1, 'Alice'],
                [2, 'Bob'],
            ];
            const columns = ['id', 'name'];
            expect(rowsToJSON(rows, columns)).toBe(
                '[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]',
            );
        });

        it('should handle single row', () => {
            const rows = [[1, 'test']];
            const columns = ['id', 'value'];
            expect(rowsToJSON(rows, columns)).toBe('[{"id":1,"value":"test"}]');
        });

        it('should handle empty rows array', () => {
            expect(rowsToJSON([], ['id'])).toBe('[]');
        });

        it('should handle null values in rows', () => {
            const rows = [
                [1, null],
                [2, 'value'],
            ];
            const columns = ['id', 'name'];
            expect(rowsToJSON(rows, columns)).toBe(
                '[{"id":1,"name":null},{"id":2,"name":"value"}]',
            );
        });
    });

    describe('rowsToHtmlTable', () => {
        it('should build a table with a header row and one row per record', () => {
            const rows = [
                [1, 'Alice'],
                [2, 'Bob'],
            ];
            expect(rowsToHtmlTable(rows, ['id', 'name'])).toBe(
                '<table><thead><tr><th>id</th><th>name</th></tr></thead>' +
                    '<tbody><tr><td>1</td><td>Alice</td></tr><tr><td>2</td><td>Bob</td></tr></tbody></table>',
            );
        });

        it('should escape HTML special characters in values and headers', () => {
            const rows = [['<b>Tom & "Jerry"</b>', "it's"]];
            expect(rowsToHtmlTable(rows, ['a<b', 'c&d'])).toBe(
                '<table><thead><tr><th>a&lt;b</th><th>c&amp;d</th></tr></thead>' +
                    '<tbody><tr><td>&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt;</td><td>it&#39;s</td></tr></tbody></table>',
            );
        });

        it('should use the given NULL label for null and undefined values', () => {
            expect(rowsToHtmlTable([[null, undefined]], ['a', 'b'], 'NULL')).toBe(
                '<table><thead><tr><th>a</th><th>b</th></tr></thead>' +
                    '<tbody><tr><td>NULL</td><td>NULL</td></tr></tbody></table>',
            );
        });

        it('should default the NULL label to "null"', () => {
            expect(rowsToHtmlTable([[null]], ['a'])).toContain('<td>null</td>');
        });

        it('should format booleans and objects like the other copy formats', () => {
            expect(rowsToHtmlTable([[true, {k: 1}]], ['flag', 'data'])).toContain(
                '<td>true</td><td>{&quot;k&quot;:1}</td>',
            );
        });

        it('should keep line breaks inside a cell', () => {
            expect(rowsToHtmlTable([['line1\nline2\r\nline3']], ['text'])).toContain(
                '<td>line1<br>line2<br>line3</td>',
            );
        });

        it('should return only the header row when there are no rows', () => {
            expect(rowsToHtmlTable([], ['id'])).toBe(
                '<table><thead><tr><th>id</th></tr></thead><tbody></tbody></table>',
            );
        });
    });

    describe('columnNamesAsLines', () => {
        it('should format multiple column names in grid order', () => {
            const columns = ['id', 'name', 'email'];
            expect(columnNamesAsLines(columns)).toBe('id\nname\nemail');
        });

        it('should handle single column name', () => {
            expect(columnNamesAsLines(['id'])).toBe('id');
        });

        it('should return empty string for empty array', () => {
            expect(columnNamesAsLines([])).toBe('');
        });

        it('should handle columns with empty names', () => {
            const columns = ['id', '', 'email'];
            expect(columnNamesAsLines(columns)).toBe('id\n\nemail');
        });
    });

    describe('columnNamesAsJson', () => {
        it('should format multiple columns in grid order as JSON array', () => {
            const columns = ['id', 'name', 'email'];
            expect(columnNamesAsJson(columns)).toBe('["id","name","email"]');
        });

        it('should handle single column name', () => {
            expect(columnNamesAsJson(['id'])).toBe('["id"]');
        });

        it('should return empty array string for empty columns array', () => {
            expect(columnNamesAsJson([])).toBe('[]');
        });

        it('should handle columns with empty names', () => {
            const columns = ['id', '', 'email'];
            expect(columnNamesAsJson(columns)).toBe('["id","","email"]');
        });

        it('should escape quotes and backslashes in column names', () => {
            const columns = ['col"name', 'col\\name'];
            expect(columnNamesAsJson(columns)).toBe('["col\\"name","col\\\\name"]');
        });

        it('should produce valid JSON parseable back to the original array', () => {
            const columns = ['id', 'user"name', 'path\\to\\field', '', 'email'];
            const jsonStr = columnNamesAsJson(columns);
            expect(JSON.parse(jsonStr)).toEqual(columns);
        });
    });

    describe('getSelectedRows', () => {
        const data = [
            [1, 'row1'],
            [2, 'row2'],
            [3, 'row3'],
            [4, 'row4'],
            [5, 'row5'],
        ];

        it('should return selected rows in sorted order', () => {
            const selected = new Set([2, 0, 4]);
            const result = getSelectedRows(data, selected);

            expect(result).toEqual([
                [1, 'row1'],
                [3, 'row3'],
                [5, 'row5'],
            ]);
        });

        it('should handle single selection', () => {
            const selected = new Set([2]);
            const result = getSelectedRows(data, selected);

            expect(result).toEqual([[3, 'row3']]);
        });

        it('should handle empty selection', () => {
            const selected = new Set<number>();
            const result = getSelectedRows(data, selected);

            expect(result).toEqual([]);
        });

        it('should handle all rows selected', () => {
            const selected = new Set([0, 1, 2, 3, 4]);
            const result = getSelectedRows(data, selected);

            expect(result).toEqual(data);
        });

        it('should sort indices even if provided out of order', () => {
            const selected = new Set([4, 1, 3]);
            const result = getSelectedRows(data, selected);

            expect(result).toEqual([
                [2, 'row2'],
                [4, 'row4'],
                [5, 'row5'],
            ]);
        });
    });

    describe('columnValuesForCopy', () => {
        const rows = [
            [1, 'Alice'],
            [2, "O'Brien"],
            [3, null],
        ];
        const columns = ['id', 'name'];

        it('should use the configured CSV header setting', () => {
            expect(
                columnValuesForCopy(rows, columns, 1, {
                    format: 'csv',
                    delimiter: ';',
                    includeHeader: true,
                }),
            ).toBe("name\nAlice\nO'Brien\nnull");

            expect(
                columnValuesForCopy(rows, columns, 0, {
                    format: 'csv',
                    includeHeader: false,
                }),
            ).toBe('1\n2\n3');
        });

        it('should format the selected column as JSON', () => {
            expect(columnValuesForCopy(rows, columns, 1, {format: 'json'})).toBe(
                '[{"name":"Alice"},{"name":"O\'Brien"},{"name":null}]',
            );
        });

        it('should format the selected column as SQL INSERT statements', () => {
            expect(
                columnValuesForCopy(rows, columns, 1, {
                    format: 'sql-insert',
                    tableName: 'users',
                }),
            ).toBe(
                "INSERT INTO `users` (`name`) VALUES ('Alice');\n" +
                    "INSERT INTO `users` (`name`) VALUES ('O''Brien');\n" +
                    'INSERT INTO `users` (`name`) VALUES (NULL);',
            );
        });

        it('should format the selected column as Markdown', () => {
            expect(
                columnValuesForCopy(rows, columns, 1, {
                    format: 'markdown',
                    includeHeader: true,
                }),
            ).toBe("| name |\n| --- |\n| Alice |\n| O'Brien |\n| null |");
        });

        it('should return an empty string for an unknown column', () => {
            expect(columnValuesForCopy(rows, columns, -1, {format: 'csv'})).toBe('');
        });
    });

    describe('columnValuesToInClause', () => {
        it('should quote strings, escape quotes, and preserve SQL literals', () => {
            const rows = [
                [1, 'Alice'],
                [2, "O'Brien"],
                [3, null],
                [4, true],
            ];

            expect(columnValuesToInClause(rows, 0)).toBe('1, 2, 3, 4');
            expect(columnValuesToInClause(rows, 1)).toBe("'Alice', 'O''Brien', NULL, TRUE");
        });

        it('backslash-escapes strings for a GoogleSQL driver', () => {
            const bq = GOOGLESQL_CAPS;
            const rows = [["O'Brien\\"], [null]];
            expect(columnValuesToInClause(rows, 0, bq)).toBe("'O\\'Brien\\\\', NULL");
            expect(columnValuesToInClause(rows, 0, 'postgres')).toBe("'O''Brien\\', NULL");
        });
    });

    describe('rowsToSqlInsert', () => {
        it('quotes values for the driver dialect', () => {
            const bq = GOOGLESQL_CAPS;
            expect(rowsToSqlInsert([[1, "it's"]], ['id', 'name'], 't', bq)).toBe(
                "INSERT INTO `t` (`id`, `name`) VALUES (1, 'it\\'s');",
            );
            expect(rowsToSqlInsert([[1, "it's"]], ['id', 'name'], 't')).toBe(
                "INSERT INTO `t` (`id`, `name`) VALUES (1, 'it''s');",
            );
        });

        it('writes booleans in the declared boolean_literals style', () => {
            const numeric = {
                ...GOOGLESQL_CAPS,
                sql_syntax: {...GOOGLESQL_CAPS.sql_syntax, boolean_literals: 'numeric' as const},
            };
            const rows = [[1, true, false]];
            const cols = ['id', 'a', 'b'];
            expect(rowsToSqlInsert(rows, cols, 't', GOOGLESQL_CAPS)).toBe(
                'INSERT INTO `t` (`id`, `a`, `b`) VALUES (1, TRUE, FALSE);',
            );
            expect(rowsToSqlInsert(rows, cols, 't', numeric)).toBe(
                'INSERT INTO `t` (`id`, `a`, `b`) VALUES (1, 1, 0);',
            );
            // Built-in drivers keep TRUE/FALSE.
            expect(rowsToSqlInsert(rows, cols, 't', 'mysql')).toBe(
                'INSERT INTO `t` (`id`, `a`, `b`) VALUES (1, TRUE, FALSE);',
            );
            expect(rowsToSqlInsert(rows, cols, 't', undefined)).toBe(
                'INSERT INTO `t` (`id`, `a`, `b`) VALUES (1, TRUE, FALSE);',
            );
            // Postgres and SQLite quote identifiers with double quotes, not backticks.
            for (const driver of ['postgres', 'sqlite']) {
                expect(rowsToSqlInsert(rows, cols, 't', driver)).toBe(
                    'INSERT INTO "t" ("id", "a", "b") VALUES (1, TRUE, FALSE);',
                );
            }
            expect(columnValuesToInClause([[true], [false]], 0, numeric)).toBe('1, 0');
        });

        it('passes the driver through formatRowsForCopy and columnValuesForCopy', () => {
            const bq = GOOGLESQL_CAPS;
            expect(
                formatRowsForCopy([["a'b"]], ['c'], 'sql-insert', {tableName: 't', driver: bq}),
            ).toBe("INSERT INTO `t` (`c`) VALUES ('a\\'b');");
            expect(
                columnValuesForCopy([["a'b"]], ['c'], 0, {
                    format: 'sql-insert',
                    tableName: 't',
                    driver: bq,
                }),
            ).toBe("INSERT INTO `t` (`c`) VALUES ('a\\'b');");
        });
    });

    describe('rowsToSqlUpdate', () => {
        const columns = ['id', 'email', 'name'];

        it('puts the primary key in WHERE and every other column in SET', () => {
            const rows = [
                [1, 'ada@example.com', 'Ada'],
                [2, 'alan@example.com', 'Alan'],
            ];
            expect(rowsToSqlUpdate(rows, columns, 'users', ['id'], 'postgres')).toBe(
                `UPDATE "users" SET "email" = 'ada@example.com', "name" = 'Ada' WHERE "id" = 1;\n` +
                    `UPDATE "users" SET "email" = 'alan@example.com', "name" = 'Alan' WHERE "id" = 2;`,
            );
        });

        it('joins a composite key with AND and leaves key columns out of SET', () => {
            const cols = ['post_id', 'lang', 'title'];
            expect(rowsToSqlUpdate([[7, 'en', 'Hello']], cols, 'titles', ['post_id', 'lang'])).toBe(
                "UPDATE `titles` SET `title` = 'Hello' WHERE `post_id` = 7 AND `lang` = 'en';",
            );
        });

        it('writes NULL values in SET as NULL', () => {
            expect(rowsToSqlUpdate([[1, null, 'Ada']], columns, 'users', ['id'])).toBe(
                "UPDATE `users` SET `email` = NULL, `name` = 'Ada' WHERE `id` = 1;",
            );
        });

        it('quotes identifiers and values for the driver like the INSERT format', () => {
            const rows = [[1, "O'Brien", true]];
            const cols = ['id', 'name', 'active'];
            expect(rowsToSqlUpdate(rows, cols, 't', ['id'], 'mysql')).toBe(
                "UPDATE `t` SET `name` = 'O''Brien', `active` = TRUE WHERE `id` = 1;",
            );
            expect(rowsToSqlUpdate(rows, cols, 't', ['id'], 'sqlite')).toBe(
                `UPDATE "t" SET "name" = 'O''Brien', "active" = TRUE WHERE "id" = 1;`,
            );
            expect(rowsToSqlUpdate(rows, cols, 't', ['id'], GOOGLESQL_CAPS)).toBe(
                "UPDATE `t` SET `name` = 'O\\'Brien', `active` = TRUE WHERE `id` = 1;",
            );
        });
    });

    describe('sqlUpdateBlocker', () => {
        it('allows a result with its whole key and at least one other column', () => {
            expect(sqlUpdateBlocker(['id', 'name'], ['id'])).toBeNull();
            expect(sqlUpdateBlocker(['a', 'b', 'c'], ['a', 'b'])).toBeNull();
        });

        it('says why an UPDATE cannot be built', () => {
            expect(sqlUpdateBlocker(['id', 'name'], null)).toBe('no-key');
            expect(sqlUpdateBlocker(['id', 'name'], [])).toBe('no-key');
            expect(sqlUpdateBlocker(['name'], ['id'])).toBe('key-not-in-result');
            expect(sqlUpdateBlocker(['a', 'b'], ['a', 'b'])).toBe('only-key-columns');
        });

        it('blocks rows without a key value, such as an unsaved insertion', () => {
            const cols = ['id', 'name'];
            expect(sqlUpdateBlocker(cols, ['id'], [[1, 'Ada']])).toBeNull();
            expect(sqlUpdateBlocker(cols, ['id'], [[1, null]])).toBeNull();
            for (const missing of [null, undefined]) {
                expect(
                    sqlUpdateBlocker(
                        cols,
                        ['id'],
                        [
                            [1, 'Ada'],
                            [missing, 'New'],
                        ],
                    ),
                ).toBe('row-without-key-value');
            }
            expect(sqlUpdateBlocker(['a', 'b', 'c'], ['a', 'b'], [[1, null, 'x']])).toBe(
                'row-without-key-value',
            );
        });
    });

    describe('formatRowsForCopy with sql-update', () => {
        const options = {tableName: 'users', driver: 'postgres'};

        it('copies UPDATE statements when the result has a usable key', () => {
            expect(
                formatRowsForCopy([[1, 'Ada']], ['id', 'name'], 'sql-update', {
                    ...options,
                    pkColumns: ['id'],
                }),
            ).toBe(`UPDATE "users" SET "name" = 'Ada' WHERE "id" = 1;`);
        });

        it('falls back to INSERT without a usable key, since no safe WHERE exists', () => {
            for (const pkColumns of [undefined, null, [], ['user_id']]) {
                expect(
                    formatRowsForCopy([[1, 'Ada']], ['id', 'name'], 'sql-update', {
                        ...options,
                        pkColumns,
                    }),
                ).toBe(`INSERT INTO "users" ("id", "name") VALUES (1, 'Ada');`);
            }
            expect(
                columnValuesForCopy([['Ada']], ['name'], 0, {...options, format: 'sql-update'}),
            ).toBe(`INSERT INTO "users" ("name") VALUES ('Ada');`);
        });

        it('falls back to INSERT when a row has no key value, instead of WHERE "id" IS NULL', () => {
            expect(
                formatRowsForCopy([[null, 'New']], ['id', 'name'], 'sql-update', {
                    ...options,
                    pkColumns: ['id'],
                }),
            ).toBe(`INSERT INTO "users" ("id", "name") VALUES (NULL, 'New');`);
        });
    });

    describe('copyTextToClipboard', () => {
        beforeEach(() => {
            // Mock clipboard API
            Object.assign(navigator, {
                clipboard: {
                    writeText: vi.fn(),
                },
            });
        });

        it('should copy text to clipboard', async () => {
            const mockWriteText = vi.fn().mockResolvedValue(undefined);
            Object.assign(navigator.clipboard, {writeText: mockWriteText});

            await copyTextToClipboard('test text');

            expect(mockWriteText).toHaveBeenCalledWith('test text');
        });

        it('should call error handler on failure', async () => {
            const error = new Error('Clipboard error');
            const mockWriteText = vi.fn().mockRejectedValue(error);
            Object.assign(navigator.clipboard, {writeText: mockWriteText});

            const onError = vi.fn();
            await copyTextToClipboard('test', onError);

            expect(onError).toHaveBeenCalledWith(error);
        });

        it('should throw error if no error handler provided', async () => {
            const error = new Error('Clipboard error');
            const mockWriteText = vi.fn().mockRejectedValue(error);
            Object.assign(navigator.clipboard, {writeText: mockWriteText});

            await expect(copyTextToClipboard('test')).rejects.toThrow('Clipboard error');
        });

        it('should handle empty string', async () => {
            const mockWriteText = vi.fn().mockResolvedValue(undefined);
            Object.assign(navigator.clipboard, {writeText: mockWriteText});

            await copyTextToClipboard('');

            expect(mockWriteText).toHaveBeenCalledWith('');
        });
    });
});

describe('CSV clipboard quoting', () => {
    it('quotes a value that contains the delimiter', () => {
        expect(rowToCSV(['Rome, Italy', 3])).toBe('"Rome, Italy",3');
    });

    it('quotes a value with a double quote and doubles the quote', () => {
        expect(rowToCSV(['say "hi"'])).toBe('"say ""hi"""');
    });

    it('quotes a value with a lone carriage return, as the file export does', () => {
        expect(rowsToCSV([['hello\rworld', 'x']])).toBe('"hello\rworld",x');
    });

    it('quotes a value with a line break', () => {
        expect(rowsToCSV([['line1\nline2', 'x']])).toBe('"line1\nline2",x');
    });

    it('leaves plain values unquoted', () => {
        expect(rowsToCSV([['a', 1, null]])).toBe('a,1,null');
    });

    it('quotes header names the same way as the body', () => {
        expect(rowsToCSVWithHeaders([['Rome, Italy']], ['city, name'])).toBe(
            '"city, name"\n"Rome, Italy"',
        );
    });
});

describe('rowsToMarkdown', () => {
    it('formats rows as a GFM table with header and separator', () => {
        const result = rowsToMarkdown(
            [
                [1, 'Alice'],
                [2, 'Bob'],
            ],
            ['id', 'name'],
        );
        expect(result).toBe('| id | name |\n| --- | --- |\n| 1 | Alice |\n| 2 | Bob |');
    });

    it('renders null/undefined cells with the null label', () => {
        const result = rowsToMarkdown([[null, undefined]], ['a', 'b']);
        expect(result).toBe('| a | b |\n| --- | --- |\n| null | null |');
    });

    it('escapes pipes and converts newlines to <br>', () => {
        const result = rowsToMarkdown([['a|b', 'line1\nline2']], ['col1', 'col2']);
        expect(result).toBe('| col1 | col2 |\n| --- | --- |\n| a\\|b | line1<br>line2 |');
    });

    it('omits header and separator when includeHeaders is false', () => {
        const result = rowsToMarkdown([[1, 'Alice']], ['id', 'name'], 'null', false);
        expect(result).toBe('| 1 | Alice |');
    });

    it('returns only header and separator when there are no rows', () => {
        const result = rowsToMarkdown([], ['x']);
        expect(result).toBe('| x |\n| --- |');
    });
});

describe('formatRowsForCopy NULL label', () => {
    const rows = [
        [1, 'Ada', null],
        [2, 'Alan', undefined],
    ];
    const columns = ['id', 'name', 'phone'];

    it.each([
        ['null', 'id,name,phone\n1,Ada,null\n2,Alan,null'],
        ['NULL', 'id,name,phone\n1,Ada,NULL\n2,Alan,NULL'],
        ['', 'id,name,phone\n1,Ada,\n2,Alan,'],
    ])('writes NULL as %j in CSV with headers', (nullLabel, expected) => {
        expect(formatRowsForCopy(rows, columns, 'csv', {withHeaders: true, nullLabel})).toBe(
            expected,
        );
    });

    it.each([
        ['null', '1;Ada;null\n2;Alan;null'],
        ['NULL', '1;Ada;NULL\n2;Alan;NULL'],
        ['', '1;Ada;\n2;Alan;'],
    ])('writes NULL as %j in CSV without headers', (nullLabel, expected) => {
        expect(formatRowsForCopy(rows, columns, 'csv', {csvDelimiter: ';', nullLabel})).toBe(
            expected,
        );
    });

    it.each([
        ['null', '| 1 | Ada | null |\n| 2 | Alan | null |'],
        ['NULL', '| 1 | Ada | NULL |\n| 2 | Alan | NULL |'],
        ['', '| 1 | Ada |  |\n| 2 | Alan |  |'],
    ])('writes NULL as %j in Markdown', (nullLabel, expected) => {
        expect(formatRowsForCopy(rows, columns, 'markdown', {nullLabel})).toBe(expected);
        expect(formatRowsForCopy(rows, columns, 'markdown', {withHeaders: true, nullLabel})).toBe(
            `| id | name | phone |\n| --- | --- | --- |\n${expected}`,
        );
    });

    it('keeps the text null by default', () => {
        expect(formatRowsForCopy(rows, columns, 'csv')).toBe('1,Ada,null\n2,Alan,null');
    });

    it('leaves JSON and SQL INSERT unchanged', () => {
        for (const nullLabel of ['null', 'NULL', '']) {
            expect(formatRowsForCopy(rows, columns, 'json', {nullLabel})).toBe(
                '[{"id":1,"name":"Ada","phone":null},{"id":2,"name":"Alan","phone":null}]',
            );
            expect(
                formatRowsForCopy(rows, columns, 'sql-insert', {tableName: 'people', nullLabel}),
            ).toBe(
                "INSERT INTO `people` (`id`, `name`, `phone`) VALUES (1, 'Ada', NULL);\n" +
                    "INSERT INTO `people` (`id`, `name`, `phone`) VALUES (2, 'Alan', NULL);",
            );
        }
    });

    it('applies the NULL label to single-column copies', () => {
        expect(
            columnValuesForCopy(rows, columns, 2, {
                format: 'csv',
                includeHeader: true,
                nullLabel: '',
            }),
        ).toBe('phone\n\n');
        expect(
            columnValuesForCopy(rows, columns, 2, {
                format: 'markdown',
                includeHeader: false,
                nullLabel: 'NULL',
            }),
        ).toBe('| NULL |\n| NULL |');
    });
});

describe('SQL INSERT copy quoting', () => {
    it("quotes identifiers with the driver's own quote character", () => {
        expect(rowsToSqlInsert([[1, 'a']], ['id', 'name'], 'users', 'postgres')).toBe(
            'INSERT INTO "users" ("id", "name") VALUES (1, \'a\');',
        );
    });

    it('keeps MySQL backticks for a MySQL driver', () => {
        expect(rowsToSqlInsert([[1]], ['id'], 'users', 'mysql')).toBe(
            'INSERT INTO `users` (`id`) VALUES (1);',
        );
    });

    it('uses double quotes for SQL Server identifiers', () => {
        expect(rowsToSqlInsert([[1]], ['id'], 'users', 'mssql')).toBe(
            'INSERT INTO "users" ("id") VALUES (1);',
        );
    });

    it('uses a plugin driver’s identifier quote and escapes that quote', () => {
        const capabilities = {identifier_quote: '~'} as DriverCapabilities;
        expect(rowsToSqlInsert([[1]], ['we~ird'], 'user~table', capabilities)).toBe(
            'INSERT INTO ~user~~table~ (~we~~ird~) VALUES (1);',
        );
    });

    it('escapes a quote in PostgreSQL identifiers', () => {
        expect(rowsToSqlInsert([[1]], ['we"ird'], 'user"table', 'postgres')).toBe(
            'INSERT INTO "user""table" ("we""ird") VALUES (1);',
        );
    });

    it('keeps backticks when no driver is given', () => {
        expect(rowsToSqlInsert([[1]], ['id'], 'users')).toBe(
            'INSERT INTO `users` (`id`) VALUES (1);',
        );
    });
});
