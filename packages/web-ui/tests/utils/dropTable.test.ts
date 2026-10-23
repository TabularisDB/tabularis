import {describe, it, expect, vi} from 'vitest';
import {buildDropTableSql, resolveDropTableSql} from '@/utils/dropTable';
import manifestSchema from '../../../../plugins/manifest.schema.json';
import extensionsSchema from '../../../../plugins/tabularium-extensions.schema.json';
import type {DriverCapabilities} from '@/types/plugins';

const backtickPlugin: DriverCapabilities = {
    schemas: true,
    views: true,
    routines: false,
    file_based: false,
    folder_based: false,
    identifier_quote: '`',
    alter_primary_key: false,
    sql_dialect: 'generic',
};

describe('dropTable', () => {
    describe('resolveDropTableSql', () => {
        it('should use the plugin statement when one is returned', () => {
            expect(
                resolveDropTableSql(
                    'DROP SNAPSHOT TABLE `proj.sales.daily`',
                    'daily',
                    backtickPlugin,
                    'sales',
                ),
            ).toBe('DROP SNAPSHOT TABLE `proj.sales.daily`');
        });

        it('should trim the plugin statement', () => {
            expect(resolveDropTableSql('  DROP EXTERNAL TABLE x \n', 'x', 'postgres')).toBe(
                'DROP EXTERNAL TABLE x',
            );
        });

        it('should fall back to a generic DROP TABLE with the plugin quote', () => {
            expect(resolveDropTableSql(null, 'daily', backtickPlugin, 'sales')).toBe(
                'DROP TABLE `sales`.`daily`',
            );
        });

        it('should fall back when the plugin statement is blank or missing', () => {
            expect(resolveDropTableSql('   ', 'users', 'postgres', 'public')).toBe(
                'DROP TABLE "public"."users"',
            );
            expect(resolveDropTableSql(undefined, 'users', 'mysql')).toBe('DROP TABLE `users`');
        });

        it('should ignore non-string plugin results', () => {
            for (const reply of [[], {}, 42, true]) {
                expect(resolveDropTableSql(reply, 'daily', backtickPlugin, 'sales')).toBe(
                    'DROP TABLE `sales`.`daily`',
                );
            }
        });
    });

    describe('buildDropTableSql', () => {
        it('should not call the plugin when drop_table_sql is not declared', async () => {
            const fetch = vi.fn().mockResolvedValue([]);
            await expect(
                buildDropTableSql(backtickPlugin, fetch, 'daily', backtickPlugin, 'sales'),
            ).resolves.toBe('DROP TABLE `sales`.`daily`');
            await expect(buildDropTableSql(null, fetch, 'users', 'postgres')).resolves.toBe(
                'DROP TABLE "users"',
            );
            expect(fetch).not.toHaveBeenCalled();
        });

        it('should use the plugin statement when drop_table_sql is declared', async () => {
            const capabilities = {...backtickPlugin, drop_table_sql: true};
            const fetch = vi.fn().mockResolvedValue('DROP SNAPSHOT TABLE `proj.sales.daily`');
            await expect(
                buildDropTableSql(capabilities, fetch, 'daily', capabilities, 'sales'),
            ).resolves.toBe('DROP SNAPSHOT TABLE `proj.sales.daily`');
            expect(fetch).toHaveBeenCalledOnce();
        });

        it('should fall back when an opted-in plugin returns nothing usable', async () => {
            const capabilities = {...backtickPlugin, drop_table_sql: true};
            const fetch = vi.fn().mockResolvedValue(null);
            await expect(
                buildDropTableSql(capabilities, fetch, 'daily', capabilities, 'sales'),
            ).resolves.toBe('DROP TABLE `sales`.`daily`');
        });

        it('should propagate plugin errors so nothing is executed', async () => {
            const capabilities = {...backtickPlugin, drop_table_sql: true};
            const fetch = vi.fn().mockRejectedValue(new Error('table not found'));
            await expect(
                buildDropTableSql(capabilities, fetch, 'daily', capabilities, 'sales'),
            ).rejects.toThrow('table not found');
        });
    });

    describe('manifest contract', () => {
        for (const [name, schema] of Object.entries({manifestSchema, extensionsSchema})) {
            it(`declares drop_table_sql as an optional, default-false capability in ${name}`, () => {
                const capabilities = schema.properties.capabilities;
                expect(capabilities.properties.drop_table_sql).toMatchObject({
                    type: 'boolean',
                    default: false,
                });
                if ('required' in capabilities) {
                    expect(capabilities.required).not.toContain('drop_table_sql');
                }
            });
        }
    });
});
