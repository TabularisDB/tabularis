import {describe, it, expect} from 'vitest';
import {
    PARAM_TYPES,
    extractParamReferences,
    hasParamReferences,
    resolveParams,
    validateParamName,
    createParam,
    updateParam,
    removeParam,
    addParam,
    applyParamDrafts,
    canApplyParamDrafts,
    changeParamType,
    draftFor,
    hasPendingParamDrafts,
    isParamPending,
    normalizeParam,
    paramLiteral,
    supportsTypedParams,
    validateParam,
    withParamDraft,
    withoutParamDraft,
} from '@/utils/notebookParams';
import type {NotebookParam, NotebookParamType} from '@/types/notebook';
import type {DriverCapabilities} from '@/types/plugins';
import {resolveSqlSyntax} from '@/utils/sqlSyntax';

describe('notebookParams', () => {
    describe('extractParamReferences', () => {
        it('should extract single param', () => {
            const refs = extractParamReferences('SELECT * WHERE date > @start_date');
            expect(refs).toHaveLength(1);
            expect(refs[0]).toEqual({match: '@start_date', name: 'start_date'});
        });

        it('should extract multiple params', () => {
            const refs = extractParamReferences('SELECT * WHERE date BETWEEN @start AND @end');
            expect(refs).toHaveLength(2);
            expect(refs[0].name).toBe('start');
            expect(refs[1].name).toBe('end');
        });

        it('should return empty for no params', () => {
            expect(extractParamReferences('SELECT 1')).toEqual([]);
        });

        it('should handle email-like strings correctly', () => {
            const refs = extractParamReferences('SELECT * WHERE name = @user_name');
            expect(refs).toHaveLength(1);
            expect(refs[0].name).toBe('user_name');
        });
    });

    describe('hasParamReferences', () => {
        it('should return true when params exist', () => {
            expect(hasParamReferences('SELECT @foo')).toBe(true);
        });

        it('should return false when no params', () => {
            expect(hasParamReferences('SELECT 1')).toBe(false);
        });

        it.each(['SELECT @foo', 'SELECT ${foo}'])(
            'should consistently detect repeated references in %s',
            (sql) => {
                for (let i = 0; i < 3; i++) {
                    expect(hasParamReferences(sql)).toBe(true);
                }
            },
        );

        it('should stay consistent when both syntaxes and no refs are interleaved', () => {
            for (let i = 0; i < 3; i++) {
                expect(hasParamReferences('SELECT @foo')).toBe(true);
                expect(hasParamReferences('SELECT ${foo}')).toBe(true);
                expect(hasParamReferences('SELECT 1')).toBe(false);
                expect(hasParamReferences('SELECT @foo, ${bar}')).toBe(true);
                expect(hasParamReferences('SELECT @foo, ${bar}')).toBe(true);
                expect(hasParamReferences('')).toBe(false);
                expect(hasParamReferences('SELECT ${foo}')).toBe(true);
                expect(hasParamReferences('SELECT @foo')).toBe(true);
            }
        });
    });

    describe('resolveParams', () => {
        const params: NotebookParam[] = [
            {name: 'start_date', value: "'2026-01-01'"},
            {name: 'limit', value: '100'},
        ];

        it('should replace param references with values', () => {
            const result = resolveParams('SELECT * WHERE date > @start_date LIMIT @limit', params);
            expect(result.sql).toBe("SELECT * WHERE date > '2026-01-01' LIMIT 100");
            expect(result.unresolvedParams).toEqual([]);
        });

        it('should report unresolved params', () => {
            const result = resolveParams('SELECT @unknown', params);
            expect(result.unresolvedParams).toEqual(['unknown']);
        });

        it('should return original SQL when no params', () => {
            const result = resolveParams('SELECT 1', params);
            expect(result.sql).toBe('SELECT 1');
        });

        it('should replace all occurrences of same param', () => {
            const result = resolveParams('SELECT @limit, @limit', params);
            expect(result.sql).toBe('SELECT 100, 100');
        });

        it('should keep regex replacement patterns in values literal', () => {
            const result = resolveParams('SELECT * FROM t WHERE a = @p', [
                {name: 'p', value: '100$&2'},
            ]);
            expect(result.sql).toBe('SELECT * FROM t WHERE a = 100$&2');
        });

        it("should not expand $' or $` in values", () => {
            const result = resolveParams('SELECT @p FROM t', [
                {name: 'p', value: "$' OR $` OR $$"},
            ]);
            expect(result.sql).toBe("SELECT $' OR $` OR $$ FROM t");
        });

        it.each(['SELECT @p, @p', 'SELECT ${p}, ${p}', 'SELECT @p, ${p}'])(
            'should keep replacement tokens literal for every occurrence in %s',
            (sql) => {
                const value = "$& | $' | $` | $$ | $1";
                const result = resolveParams(sql, [{name: 'p', value}]);

                expect(result.sql).toBe(`SELECT ${value}, ${value}`);
                expect(result.unresolvedParams).toEqual([]);
            },
        );

        it('should leave a server variable such as @@version alone', () => {
            const result = resolveParams('SELECT @@version, @version', [
                {name: 'version', value: '3'},
            ]);
            expect(result.sql).toBe('SELECT @@version, 3');
            expect(result.unresolvedParams).toEqual([]);
        });

        it('should not replace @name inside string literals or comments', () => {
            const result = resolveParams(
                "SELECT * FROM t WHERE email = 'bob@example.com' AND id = @example -- @example",
                [{name: 'example', value: '7'}],
                'postgres',
            );
            expect(result.sql).toBe(
                "SELECT * FROM t WHERE email = 'bob@example.com' AND id = 7 -- @example",
            );
        });

        it('should still resolve ${name} inside a string literal', () => {
            const result = resolveParams(
                "SELECT * FROM t WHERE city = '${city}'",
                [{name: 'city', value: 'Rome'}],
                'postgres',
            );
            expect(result.sql).toBe("SELECT * FROM t WHERE city = 'Rome'");
        });

        it('should insert a value that contains another reference as is', () => {
            const result = resolveParams('SELECT @a, @b', [
                {name: 'a', value: "'@b'"},
                {name: 'b', value: '2'},
            ]);
            expect(result.sql).toBe("SELECT '@b', 2");
        });

        it('should resolve ${name} template syntax', () => {
            const result = resolveParams('SELECT * FROM t WHERE id = ${email}', [
                {name: 'email', value: "'user@example.com'"},
            ]);
            expect(result.sql).toBe("SELECT * FROM t WHERE id = 'user@example.com'");
            expect(result.unresolvedParams).toEqual([]);
        });

        it('should resolve mixed @name and ${name} syntax', () => {
            const result = resolveParams('SELECT * FROM t WHERE a = @limit AND b = ${email}', [
                {name: 'limit', value: '100'},
                {name: 'email', value: "'test@example.com'"},
            ]);
            expect(result.sql).toBe("SELECT * FROM t WHERE a = 100 AND b = 'test@example.com'");
        });

        it('should report unresolved ${name} template params', () => {
            const result = resolveParams('SELECT ${unknown}', []);
            expect(result.unresolvedParams).toEqual(['unknown']);
        });

        it('should extract ${name} template references', () => {
            const refs = extractParamReferences(
                'SELECT * WHERE id = ${user_id} AND name = ${name}',
            );
            expect(refs).toHaveLength(2);
            expect(refs[0]).toEqual({match: '${user_id}', name: 'user_id'});
            expect(refs[1]).toEqual({match: '${name}', name: 'name'});
        });

        it('should detect ${name} with hasParamReferences', () => {
            expect(hasParamReferences('SELECT ${foo}')).toBe(true);
            expect(hasParamReferences('SELECT 1')).toBe(false);
        });
    });

    describe('typed parameters', () => {
        const syntaxOf = (capabilities: Partial<DriverCapabilities>) =>
            resolveSqlSyntax(capabilities as DriverCapabilities);
        const sqlite = syntaxOf({sql_dialect: 'sqlite'});
        const postgres = syntaxOf({sql_dialect: 'postgres'});
        const mysql = syntaxOf({sql_dialect: 'mysql'});
        // A plugin on a supported dialect that declares its own literal rules.
        const plugin = syntaxOf({
            sql_dialect: 'mysql',
            sql_syntax: {string_escape: 'backslash', boolean_literals: 'numeric'},
        });
        const typed = (
            name: string,
            value: string,
            type: NotebookParamType,
            extra: Partial<NotebookParam> = {},
        ): NotebookParam => ({name, value, type, ...extra});
        const resolve = (sql: string, param: NotebookParam) =>
            resolveParams(sql, [param], sqlite).sql;

        it('should write a date parameter as a quoted date', () => {
            expect(
                resolve(
                    'SELECT id FROM orders WHERE order_date >= @start',
                    typed('start', '2026-01-01', 'date'),
                ),
            ).toBe("SELECT id FROM orders WHERE order_date >= '2026-01-01'");
        });

        it('should quote a text parameter and escape its apostrophe', () => {
            expect(
                resolve(
                    'SELECT id FROM orders WHERE customer = @name',
                    typed('name', "O'Brien", 'text'),
                ),
            ).toBe("SELECT id FROM orders WHERE customer = 'O''Brien'");
        });

        it('should keep a text parameter that holds SQL as one string', () => {
            expect(
                resolve(
                    'SELECT id FROM orders WHERE customer = @name',
                    typed('name', '1 OR 1=1', 'text'),
                ),
            ).toBe("SELECT id FROM orders WHERE customer = '1 OR 1=1'");
        });

        it('should write an empty text parameter as the empty string', () => {
            expect(
                resolve('SELECT id FROM orders WHERE customer = @name', typed('name', '', 'text')),
            ).toBe("SELECT id FROM orders WHERE customer = ''");
        });

        describe('supportsTypedParams', () => {
            it.each([
                ['postgres', postgres],
                ['mysql', mysql],
                ['sqlite', sqlite],
                ['a plugin on a supported dialect', plugin],
                [
                    'a plugin that extends a supported preset',
                    syntaxOf({sql_dialect: 'generic', sql_syntax: {extends: 'postgres'}}),
                ],
            ])('should offer typed parameters on %s', (_label, syntax) => {
                expect(supportsTypedParams(syntax)).toBe(true);
            });

            it.each([
                ['mssql', syntaxOf({sql_dialect: 'mssql'})],
                ['oracle', syntaxOf({sql_dialect: 'oracle'})],
                ['generic', syntaxOf({sql_dialect: 'generic'})],
                ['a driver that declares no dialect', syntaxOf({identifier_quote: '`'})],
                ['a bare dialect name', 'postgres'],
                ['no dialect', undefined],
            ])('should keep %s on raw parameters', (_label, syntax) => {
                expect(supportsTypedParams(syntax)).toBe(false);
            });
        });

        describe('validateParam', () => {
            it('should accept any text for a raw parameter', () => {
                expect(validateParam({name: 'p', value: ''})).toBeNull();
                expect(validateParam({name: 'p', value: "1 OR 1=1 -- '"})).toBeNull();
            });

            it.each([
                '42',
                '-5',
                '0',
                '3.14',
                '-0.10',
                '007',
                ' 42 ',
                '9007199254740993',
                '12345678901234567890.123456789',
            ])('should accept the number %j', (value) => {
                expect(validateParam(typed('n', value, 'number'))).toBeNull();
            });

            it.each(['+5', '.5', '5.', '1e3', '1,5', '1 000', 'NaN', 'Infinity', 'abc', '--5'])(
                'should reject the number %j',
                (value) => {
                    expect(validateParam(typed('n', value, 'number'))).toBe('invalidNumber');
                },
            );

            it.each(['2026-02-28', '2024-02-29', '0001-01-01', '9999-12-31'])(
                'should accept the date %j',
                (value) => {
                    expect(validateParam(typed('d', value, 'date'))).toBeNull();
                },
            );

            it.each([
                '2025-02-29',
                '2026-02-30',
                '2026-13-40',
                '2026-00-10',
                '0000-01-01',
                '2026-1-1',
                '26-01-01',
                '2026-01-01 10:00:00',
                '2026-01-01T00:00:00',
                ' 2026-01-01',
                'abc',
            ])('should reject the date %j', (value) => {
                expect(validateParam(typed('d', value, 'date'))).toBe('invalidDate');
            });

            it('should keep an empty text distinct from NULL unless a value is required', () => {
                expect(validateParam(typed('t', '', 'text'))).toBeNull();
                expect(validateParam(typed('t', '', 'text', {isNull: true}))).toBeNull();
                expect(validateParam(typed('t', '', 'text', {required: true}))).toBe('required');
                expect(validateParam(typed('t', ' ', 'text', {required: true}))).toBeNull();
            });

            it.each(['number', 'date', 'select'] as const)(
                'should ask for a value or NULL when an optional %s is empty',
                (type) => {
                    const options = {options: ['a']};
                    expect(validateParam(typed('p', '', type, options))).toBe('emptyNeedsNull');
                    expect(validateParam(typed('p', '', type, {...options, isNull: true}))).toBe(
                        null,
                    );
                    expect(validateParam(typed('p', '', type, {...options, required: true}))).toBe(
                        'required',
                    );
                },
            );

            it('should reject NULL for a required parameter of any type', () => {
                for (const type of PARAM_TYPES) {
                    const param = typed('p', 'true', type, {isNull: true, required: true});
                    expect(validateParam(param)).toBe('required');
                }
            });

            it('should accept only true and false for a boolean', () => {
                expect(validateParam(typed('b', 'true', 'boolean'))).toBeNull();
                expect(validateParam(typed('b', 'false', 'boolean'))).toBeNull();
                expect(validateParam(typed('b', '1', 'boolean'))).toBe('invalidBoolean');
                expect(validateParam(typed('b', '', 'boolean'))).toBe('invalidBoolean');
            });

            it('should require a list value to be one of its options', () => {
                const list = (value: string, options?: string[]) =>
                    typed('c', value, 'select', options ? {options} : {});
                expect(validateParam(list('Brazil', ['Brazil', 'Ireland']))).toBeNull();
                expect(validateParam(list('Brazil', [' Brazil ', '', 'Brazil']))).toBeNull();
                expect(validateParam(list('China', ['Brazil', 'Ireland']))).toBe('invalidOption');
                expect(validateParam(list('brazil', ['Brazil']))).toBe('invalidOption');
                expect(validateParam(list('Brazil', []))).toBe('noOptions');
                expect(validateParam(list('Brazil', ['', '  ']))).toBe('noOptions');
                expect(validateParam(list('Brazil'))).toBe('noOptions');
            });

            it('should reject a cell reference inside a text value or a list option', () => {
                expect(validateParam(typed('t', 'see {{cell_1}}', 'text'))).toBe('cellReference');
                expect(
                    validateParam(typed('c', 'a', 'select', {options: ['a', '{{cell_2}}']})),
                ).toBe('cellReference');
                expect(validateParam(typed('t', '{{cell}} {cell_1}', 'text'))).toBeNull();
            });
        });

        describe('paramLiteral', () => {
            // Each row: value, then the literal on postgres, sqlite, mysql and the plugin.
            it.each<[string, NotebookParam, string, string, string, string]>([
                [
                    'text with a quote and a backslash',
                    typed('p', String.raw`O'Brien \ x`, 'text'),
                    String.raw`'O''Brien \ x'`,
                    String.raw`'O''Brien \ x'`,
                    String.raw`'O''Brien \\ x'`,
                    String.raw`'O\'Brien \\ x'`,
                ],
                [
                    'Unicode text',
                    typed('p', 'São Paulo ☕ 東京', 'text'),
                    "'São Paulo ☕ 東京'",
                    "'São Paulo ☕ 東京'",
                    "'São Paulo ☕ 東京'",
                    "'São Paulo ☕ 東京'",
                ],
                ['empty text', typed('p', '', 'text'), "''", "''", "''", "''"],
                [
                    'NULL text',
                    typed('p', 'kept', 'text', {isNull: true}),
                    'NULL',
                    'NULL',
                    'NULL',
                    'NULL',
                ],
                [
                    'NULL number',
                    typed('p', '', 'number', {isNull: true}),
                    'NULL',
                    'NULL',
                    'NULL',
                    'NULL',
                ],
                ['zero', typed('p', '0', 'number'), '0', '0', '0', '0'],
                [
                    'a negative decimal',
                    typed('p', '-0.10', 'number'),
                    '(-0.10)',
                    '(-0.10)',
                    '(-0.10)',
                    '(-0.10)',
                ],
                [
                    'a number beyond double precision',
                    typed('p', '12345678901234567890.123456789', 'number'),
                    '12345678901234567890.123456789',
                    '12345678901234567890.123456789',
                    '12345678901234567890.123456789',
                    '12345678901234567890.123456789',
                ],
                [
                    'a number with spaces around it',
                    typed('p', ' 42 ', 'number'),
                    '42',
                    '42',
                    '42',
                    '42',
                ],
                ['true', typed('p', 'true', 'boolean'), 'TRUE', 'TRUE', 'TRUE', '1'],
                ['false', typed('p', 'false', 'boolean'), 'FALSE', 'FALSE', 'FALSE', '0'],
                [
                    'a date',
                    typed('p', '2026-02-28', 'date'),
                    "'2026-02-28'",
                    "'2026-02-28'",
                    "'2026-02-28'",
                    "'2026-02-28'",
                ],
                [
                    'a list option',
                    typed('p', "Côte d'Ivoire", 'select', {options: ["Côte d'Ivoire"]}),
                    "'Côte d''Ivoire'",
                    "'Côte d''Ivoire'",
                    "'Côte d''Ivoire'",
                    String.raw`'Côte d\'Ivoire'`,
                ],
            ])('should write %s for each dialect', (_label, param, pg, lite, my, custom) => {
                expect(paramLiteral(param, postgres)).toBe(pg);
                expect(paramLiteral(param, sqlite)).toBe(lite);
                expect(paramLiteral(param, mysql)).toBe(my);
                expect(paramLiteral(param, plugin)).toBe(custom);
            });
        });

        describe('resolveParams', () => {
            const name = typed('name', "O'Brien", 'text');

            it('should replace both reference forms in code', () => {
                const {sql, errors} = resolveParams(
                    'SELECT * FROM t WHERE a = @name AND b = ${name}',
                    [name],
                    postgres,
                );
                expect(sql).toBe("SELECT * FROM t WHERE a = 'O''Brien' AND b = 'O''Brien'");
                expect(errors).toEqual([]);
            });

            it('should use the literal rules a plugin declares', () => {
                const {sql} = resolveParams(
                    'SELECT * FROM t WHERE a = @name AND ok = @flag',
                    [name, typed('flag', 'true', 'boolean')],
                    plugin,
                );
                expect(sql).toBe(String.raw`SELECT * FROM t WHERE a = 'O\'Brien' AND ok = 1`);
            });

            it('should wrap a negative number so it cannot open a comment', () => {
                const {sql} = resolveParams('SELECT 10-@n', [typed('n', '-5', 'number')], sqlite);
                expect(sql).toBe('SELECT 10-(-5)');
            });

            it('should keep NULL, the empty string, zero and false apart', () => {
                const {sql} = resolveParams(
                    'SELECT @none, @empty, @zero, @off',
                    [
                        typed('none', '', 'text', {isNull: true}),
                        typed('empty', '', 'text'),
                        typed('zero', '0', 'number'),
                        typed('off', 'false', 'boolean'),
                    ],
                    postgres,
                );
                expect(sql).toBe("SELECT NULL, '', 0, FALSE");
            });

            it.each([
                ['a string', "SELECT * FROM t WHERE a = '${name}'"],
                ['a pattern', "SELECT * FROM t WHERE a LIKE '%${name}%'"],
                ['a quoted identifier', 'SELECT "${name}" FROM t'],
                ['a dollar-quoted string', 'SELECT $$ ${name} $$'],
            ])(
                'should reject a typed ${name} inside %s and leave the SQL as written',
                (_l, source) => {
                    const {sql, errors, unresolvedParams} = resolveParams(source, [name], postgres);
                    expect(sql).toBe(source);
                    expect(errors).toEqual([{name: 'name', reference: '${name}', kind: 'quoted'}]);
                    expect(unresolvedParams).toEqual([]);
                },
            );

            it('should reject a typed ${name} inside MySQL double quotes and backticks', () => {
                for (const source of ['SELECT "${name}"', 'SELECT `${name}` FROM t']) {
                    const {sql, errors} = resolveParams(source, [name], mysql);
                    expect(sql).toBe(source);
                    expect(errors.map((error) => error.kind)).toEqual(['quoted']);
                }
            });

            it('should still replace a raw ${name} inside quotes', () => {
                const {sql, errors} = resolveParams(
                    "SELECT * FROM t WHERE a = '${name}'",
                    [{name: 'name', value: 'Ana'}],
                    postgres,
                );
                expect(sql).toBe("SELECT * FROM t WHERE a = 'Ana'");
                expect(errors).toEqual([]);
            });

            it('should leave @name inside a string as text, typed or not', () => {
                const source = "SELECT * FROM t WHERE email = 'bob@name.com'";
                const {sql, errors} = resolveParams(source, [name], postgres);
                expect(sql).toBe(source);
                expect(errors).toEqual([]);
            });

            it.each([
                ['postgres', postgres, 'SELECT 1 -- ${name}\n/* ${name} @name */'],
                ['mysql', mysql, 'SELECT 1 # ${name}\n-- ${name}'],
            ])('should ignore a typed reference inside a %s comment', (_label, syntax, source) => {
                const {sql, errors} = resolveParams(source, [name], syntax);
                expect(sql).toBe(source);
                expect(errors).toEqual([]);
            });

            it('should resolve raw and typed parameters in the same statement', () => {
                const {sql, errors} = resolveParams(
                    "SELECT * FROM @table WHERE a = @name AND b = '${tag}'",
                    [{name: 'table', value: 'orders'}, name, {name: 'tag', value: 'x'}],
                    sqlite,
                );
                expect(sql).toBe("SELECT * FROM orders WHERE a = 'O''Brien' AND b = 'x'");
                expect(errors).toEqual([]);
            });

            it('should not read a reference inside an inserted typed value', () => {
                const {sql} = resolveParams(
                    'SELECT @a, @b',
                    [typed('a', '@b ${b}', 'text'), typed('b', '2', 'number')],
                    sqlite,
                );
                expect(sql).toBe("SELECT '@b ${b}', 2");
            });

            it('should report an invalid value and keep its reference', () => {
                const {sql, errors} = resolveParams(
                    'SELECT * FROM t WHERE d >= @start AND d < @start',
                    [typed('start', '2025-02-29', 'date')],
                    sqlite,
                );
                expect(sql).toBe('SELECT * FROM t WHERE d >= @start AND d < @start');
                expect(errors).toEqual([
                    {name: 'start', reference: '@start', kind: 'invalid', issue: 'invalidDate'},
                ]);
            });

            it.each([
                ['an unsupported dialect', syntaxOf({sql_dialect: 'mssql'})],
                ['a driver that declares no dialect', syntaxOf({identifier_quote: '`'})],
                ['a bare dialect name', 'postgres'],
                ['no dialect', undefined],
            ])('should not write a typed parameter for %s', (_label, syntax) => {
                const source = 'SELECT * FROM @table WHERE a = @name';
                const {sql, errors} = resolveParams(
                    source,
                    [{name: 'table', value: 'orders'}, name],
                    syntax,
                );
                expect(sql).toBe('SELECT * FROM orders WHERE a = @name');
                expect(errors).toEqual([{name: 'name', reference: '@name', kind: 'unsupported'}]);
            });

            it('should list an unknown reference as unresolved, not as an error', () => {
                const {sql, unresolvedParams, errors} = resolveParams(
                    'SELECT @name, @Name',
                    [name],
                    sqlite,
                );
                expect(sql).toBe("SELECT 'O''Brien', @Name");
                expect(unresolvedParams).toEqual(['Name']);
                expect(errors).toEqual([]);
            });

            it('should report no errors for raw parameters', () => {
                expect(resolveParams('SELECT @a', [{name: 'a', value: ''}]).errors).toEqual([]);
            });
        });

        describe('normalizeParam', () => {
            it('should keep only the name and value of a raw parameter', () => {
                const raw = {name: 'a', value: ' 1 ', isNull: true, options: ['x']};
                expect(normalizeParam(raw)).toEqual({name: 'a', value: ' 1 '});
            });

            it('should trim a number and keep flags only when set', () => {
                expect(
                    normalizeParam(typed('n', ' 42 ', 'number', {isNull: false, required: true})),
                ).toEqual({name: 'n', value: '42', type: 'number', required: true});
            });

            it('should store list options trimmed, without blanks or duplicates', () => {
                expect(
                    normalizeParam(typed('c', 'a', 'select', {options: [' a ', '', 'b', 'a']})),
                ).toEqual({name: 'c', value: 'a', type: 'select', options: ['a', 'b']});
                expect(normalizeParam(typed('t', 'a', 'text', {options: ['a']}))).toEqual({
                    name: 't',
                    value: 'a',
                    type: 'text',
                });
            });
        });

        describe('changeParamType', () => {
            const raw = (value: string): NotebookParam => ({name: 'p', value});

            it('should take the quotes off a raw string for text, date and list', () => {
                expect(changeParamType(raw("'O''Brien'"), 'text')).toEqual(
                    typed('p', "O'Brien", 'text'),
                );
                expect(changeParamType(raw("'2026-01-01'"), 'date')).toEqual(
                    typed('p', '2026-01-01', 'date'),
                );
                expect(changeParamType(raw("'Brazil'"), 'select')).toEqual(
                    typed('p', 'Brazil', 'select', {options: ['Brazil']}),
                );
            });

            it('should keep a value it cannot read as typed, for validation to flag', () => {
                expect(changeParamType(raw("'a' || 'b'"), 'text').value).toBe("'a' || 'b'");
                expect(changeParamType(raw('abc'), 'number')).toEqual(typed('p', 'abc', 'number'));
                expect(changeParamType(raw('today'), 'date')).toEqual(typed('p', 'today', 'date'));
                expect(changeParamType(raw(''), 'select')).toEqual(
                    typed('p', '', 'select', {options: []}),
                );
            });

            it('should keep a numeric literal and read true, false, 1 and 0 as a boolean', () => {
                expect(changeParamType(raw(' 42 '), 'number').value).toBe('42');
                expect(changeParamType(raw('TRUE'), 'boolean').value).toBe('true');
                expect(changeParamType(raw('1'), 'boolean').value).toBe('true');
                expect(changeParamType(raw('0'), 'boolean').value).toBe('false');
                expect(changeParamType(raw('abc'), 'boolean').value).toBe('false');
            });

            it('should not unquote a value that is already typed', () => {
                expect(changeParamType(typed('p', "'x'", 'text'), 'select').value).toBe("'x'");
            });

            it('should carry NULL and Required between types and drop them for raw', () => {
                const text = typed('p', 'a', 'text', {isNull: true, required: true});
                expect(changeParamType(text, 'date')).toEqual(
                    typed('p', 'a', 'date', {isNull: true, required: true}),
                );
                expect(changeParamType(text, undefined)).toEqual({name: 'p', value: 'a'});
            });

            it('should return the same parameter when the type does not change', () => {
                const text = typed('p', 'a', 'text');
                expect(changeParamType(text, 'text')).toBe(text);
                expect(changeParamType(raw('a'), undefined)).toEqual(raw('a'));
            });
        });

        describe('drafts', () => {
            const limit = typed('limit', '10', 'number');
            const region = typed('region', 'EU', 'select', {options: ['EU', 'US']});
            const rawParam: NotebookParam = {name: 'tbl', value: 'orders'};
            const applied = [limit, region, rawParam];

            it('should have nothing pending without drafts', () => {
                expect(hasPendingParamDrafts(applied, {})).toBe(false);
                expect(canApplyParamDrafts(applied, {})).toBe(false);
                expect(applyParamDrafts(applied, {})).toEqual(applied);
            });

            it('should treat a draft as pending only when it would change the parameter', () => {
                const same = withParamDraft({}, {...limit, value: ' 10 '});
                expect(draftFor(limit, same)).toEqual({...limit, value: ' 10 '});
                expect(isParamPending(limit, same)).toBe(false);
                // A line being typed in the options box is not a change yet.
                const typing = withParamDraft({}, {...region, options: ['EU', 'US', '']});
                expect(isParamPending(region, typing)).toBe(false);
                expect(isParamPending(limit, withParamDraft({}, {...limit, value: '50'}))).toBe(
                    true,
                );
            });

            it('should apply every draft at once and leave other rows untouched', () => {
                const drafts = withParamDraft(
                    withParamDraft({}, {...limit, value: ' 50 '}),
                    changeParamType(rawParam, 'text'),
                );
                expect(canApplyParamDrafts(applied, drafts)).toBe(true);
                const next = applyParamDrafts(applied, drafts);
                expect(next).toEqual([
                    typed('limit', '50', 'number'),
                    region,
                    typed('tbl', 'orders', 'text'),
                ]);
                expect(next[1]).toBe(region);
            });

            it('should block Apply while any draft is invalid', () => {
                const drafts = withParamDraft(withParamDraft({}, {...limit, value: '50'}), {
                    ...region,
                    value: 'ASIA',
                });
                expect(hasPendingParamDrafts(applied, drafts)).toBe(true);
                expect(canApplyParamDrafts(applied, drafts)).toBe(false);
            });

            it('should block Apply while an applied row is invalid', () => {
                const broken = typed('since', '2025-02-29', 'date');
                const drafts = withParamDraft({}, {...limit, value: '50'});
                expect(canApplyParamDrafts([limit, broken], drafts)).toBe(false);
                expect(
                    canApplyParamDrafts(
                        [limit, broken],
                        withParamDraft(drafts, {...broken, value: '2025-02-28'}),
                    ),
                ).toBe(true);
            });

            it('should not draft a raw parameter: its value is live', () => {
                const drafts = withParamDraft({}, {name: 'tbl', value: 'customers'});
                expect(draftFor(rawParam, drafts)).toBeUndefined();
                expect(hasPendingParamDrafts(applied, drafts)).toBe(false);
                expect(applyParamDrafts(applied, drafts)).toEqual(applied);
            });

            it('should draft a typed parameter going back to raw', () => {
                const drafts = withParamDraft({}, changeParamType(limit, undefined));
                expect(isParamPending(limit, drafts)).toBe(true);
                expect(applyParamDrafts([limit], drafts)).toEqual([{name: 'limit', value: '10'}]);
            });

            it('should ignore a draft whose parameter is gone', () => {
                const drafts = withParamDraft({}, typed('gone', '1', 'number'));
                expect(hasPendingParamDrafts(applied, drafts)).toBe(false);
                expect(applyParamDrafts(applied, drafts)).toEqual(applied);
            });

            it('should drop one draft and keep the others', () => {
                const drafts = withParamDraft(withParamDraft({}, {...limit, value: '50'}), {
                    ...region,
                    value: 'US',
                });
                const rest = withoutParamDraft(drafts, 'limit');
                expect(Object.keys(rest)).toEqual(['region']);
                expect(withoutParamDraft(rest, 'limit')).toBe(rest);
            });

            it('should keep drafts for names that exist on every object', () => {
                const proto = typed('__proto__', '1', 'number');
                const ctor = typed('constructor', '1', 'number');
                expect(draftFor(ctor, {})).toBeUndefined();
                const drafts = withParamDraft(withParamDraft({}, {...proto, value: '2'}), {
                    ...ctor,
                    value: '3',
                });
                expect(applyParamDrafts([proto, ctor], drafts).map((p) => p.value)).toEqual([
                    '2',
                    '3',
                ]);
                expect(Object.keys(withoutParamDraft(drafts, '__proto__'))).toEqual([
                    'constructor',
                ]);
            });
        });
    });

    describe('validateParamName', () => {
        it('should accept valid names', () => {
            expect(validateParamName('start_date')).toBe(true);
            expect(validateParamName('x')).toBe(true);
            expect(validateParamName('limit123')).toBe(true);
        });

        it('should reject empty string', () => {
            expect(validateParamName('')).toBe(false);
        });

        it('should reject names with special chars', () => {
            expect(validateParamName('start-date')).toBe(false);
            expect(validateParamName('start date')).toBe(false);
        });
    });

    describe('CRUD operations', () => {
        const params: NotebookParam[] = [
            {name: 'a', value: '1'},
            {name: 'b', value: '2'},
        ];

        it('createParam should create a param', () => {
            expect(createParam('x', '10')).toEqual({name: 'x', value: '10'});
        });

        it('updateParam should update matching param', () => {
            const updated = updateParam(params, 'a', '99');
            expect(updated[0].value).toBe('99');
            expect(updated[1].value).toBe('2');
        });

        it('removeParam should remove matching param', () => {
            const result = removeParam(params, 'a');
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('b');
        });

        it('addParam should add new param', () => {
            const result = addParam(params, {name: 'c', value: '3'});
            expect(result).toHaveLength(3);
        });

        it('addParam should not add duplicate', () => {
            const result = addParam(params, {name: 'a', value: 'new'});
            expect(result).toHaveLength(2);
        });
    });
});
