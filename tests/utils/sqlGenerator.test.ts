import { describe, it, expect } from 'vitest';
import {
  getIdentifierQuote,
  generateColumnDefinition,
  generatePrimaryKeyConstraint,
  generateForeignKeyConstraints,
  generateIndexStatements,
  generateCreateTableSQL,
  type TableColumn,
  type ForeignKey,
  type Index,
  type DatabaseDriver,
} from '../../src/utils/sqlGenerator';
import type { DriverCapabilities } from '../../src/types/plugins';

const makeCaps = (overrides: Partial<DriverCapabilities> = {}): DriverCapabilities => ({
  schemas: false, views: false, routines: false,
  file_based: false, folder_based: false,
  identifier_quote: '"', alter_primary_key: false,
  auto_increment_keyword: '', serial_type: '', inline_pk: false,
  ...overrides,
});

describe('sqlGenerator utils', () => {
  describe('getIdentifierQuote', () => {
    it('should return backtick for MySQL', () => {
      expect(getIdentifierQuote('mysql')).toBe('`');
    });

    it('should return backtick for MariaDB', () => {
      expect(getIdentifierQuote('mariadb')).toBe('`');
    });

    it('should return double quote for PostgreSQL', () => {
      expect(getIdentifierQuote('postgresql')).toBe('"');
    });

    it('should return double quote for SQLite', () => {
      expect(getIdentifierQuote('sqlite')).toBe('"');
    });
  });

  describe('generateColumnDefinition', () => {
    const baseColumn: TableColumn = {
      name: 'id',
      data_type: 'INT',
      is_pk: true,
      is_nullable: false,
      is_auto_increment: false,
      default_value: null,
    };

    it('should generate basic column definition', () => {
      const result = generateColumnDefinition(baseColumn, 'mysql');
      expect(result).toBe('  `id` INT NOT NULL');
    });

    it('should handle nullable columns', () => {
      const column = { ...baseColumn, is_nullable: true };
      const result = generateColumnDefinition(column, 'mysql');
      expect(result).toBe('  `id` INT');
      expect(result).not.toContain('NOT NULL');
    });

    it('should add DEFAULT clause', () => {
      const column = { ...baseColumn, default_value: '0' };
      const result = generateColumnDefinition(column, 'mysql');
      expect(result).toBe('  `id` INT NOT NULL DEFAULT 0');
    });

    it('should handle string default values', () => {
      const column = { ...baseColumn, default_value: "'active'" };
      const result = generateColumnDefinition(column, 'mysql');
      expect(result).toBe("  `id` INT NOT NULL DEFAULT 'active'");
    });

    it('should add AUTO_INCREMENT for MySQL', () => {
      const column = { ...baseColumn, is_auto_increment: true };
      const result = generateColumnDefinition(column, 'mysql');
      expect(result).toBe('  `id` INT NOT NULL AUTO_INCREMENT');
    });

    it('should add AUTO_INCREMENT for MariaDB', () => {
      const column = { ...baseColumn, is_auto_increment: true };
      const result = generateColumnDefinition(column, 'mariadb');
      expect(result).toBe('  `id` INT NOT NULL AUTO_INCREMENT');
    });

    it('should convert to INTEGER PRIMARY KEY AUTOINCREMENT for SQLite', () => {
      const column = { ...baseColumn, is_auto_increment: true };
      const result = generateColumnDefinition(column, 'sqlite');
      expect(result).toContain('INTEGER PRIMARY KEY AUTOINCREMENT');
      expect(result).not.toContain('INT NOT NULL AUTO_INCREMENT');
    });

    it('should convert to SERIAL for PostgreSQL', () => {
      const column = { ...baseColumn, is_auto_increment: true };
      const result = generateColumnDefinition(column, 'postgresql');
      expect(result).toContain('SERIAL');
      expect(result).not.toContain('INT NOT NULL AUTO_INCREMENT');
    });

    it('should handle VARCHAR with length', () => {
      const column = { ...baseColumn, data_type: 'VARCHAR(255)' };
      const result = generateColumnDefinition(column, 'mysql');
      expect(result).toBe('  `id` VARCHAR(255) NOT NULL');
    });

    it('should handle custom column names with special characters', () => {
      const column = { ...baseColumn, name: 'user_name' };
      const result = generateColumnDefinition(column, 'postgresql');
      expect(result).toBe('  "user_name" INT NOT NULL');
    });

    it('should handle columns with both default and constraints', () => {
      const column = {
        ...baseColumn,
        is_nullable: false,
        default_value: 'CURRENT_TIMESTAMP',
      };
      const result = generateColumnDefinition(column, 'mysql');
      expect(result).toBe('  `id` INT NOT NULL DEFAULT CURRENT_TIMESTAMP');
    });

    it('should preserve data type case', () => {
      const column = { ...baseColumn, data_type: 'datetime' };
      const result = generateColumnDefinition(column, 'mysql');
      expect(result).toBe('  `id` datetime NOT NULL');
    });
  });

  describe('generatePrimaryKeyConstraint', () => {
    it('should return null when no primary key columns', () => {
      const columns: TableColumn[] = [
        { name: 'name', data_type: 'VARCHAR(100)', is_pk: false, is_nullable: true, is_auto_increment: false, default_value: null },
      ];
      expect(generatePrimaryKeyConstraint(columns, 'mysql')).toBeNull();
    });

    it('should return null for SQLite', () => {
      const columns: TableColumn[] = [
        { name: 'id', data_type: 'INT', is_pk: true, is_nullable: false, is_auto_increment: false, default_value: null },
      ];
      expect(generatePrimaryKeyConstraint(columns, 'sqlite')).toBeNull();
    });

    it('should generate single column primary key for MySQL', () => {
      const columns: TableColumn[] = [
        { name: 'id', data_type: 'INT', is_pk: true, is_nullable: false, is_auto_increment: false, default_value: null },
      ];
      const result = generatePrimaryKeyConstraint(columns, 'mysql');
      expect(result).toBe('  PRIMARY KEY (`id`)');
    });

    it('should generate composite primary key', () => {
      const columns: TableColumn[] = [
        { name: 'order_id', data_type: 'INT', is_pk: true, is_nullable: false, is_auto_increment: false, default_value: null },
        { name: 'product_id', data_type: 'INT', is_pk: true, is_nullable: false, is_auto_increment: false, default_value: null },
      ];
      const result = generatePrimaryKeyConstraint(columns, 'mysql');
      expect(result).toBe('  PRIMARY KEY (`order_id`, `product_id`)');
    });

    it('should use double quotes for PostgreSQL', () => {
      const columns: TableColumn[] = [
        { name: 'id', data_type: 'INT', is_pk: true, is_nullable: false, is_auto_increment: false, default_value: null },
      ];
      const result = generatePrimaryKeyConstraint(columns, 'postgresql');
      expect(result).toBe('  PRIMARY KEY ("id")');
    });

    it('should handle mixed PK and non-PK columns', () => {
      const columns: TableColumn[] = [
        { name: 'id', data_type: 'INT', is_pk: true, is_nullable: false, is_auto_increment: false, default_value: null },
        { name: 'name', data_type: 'VARCHAR(100)', is_pk: false, is_nullable: true, is_auto_increment: false, default_value: null },
        { name: 'code', data_type: 'VARCHAR(50)', is_pk: true, is_nullable: false, is_auto_increment: false, default_value: null },
      ];
      const result = generatePrimaryKeyConstraint(columns, 'mysql');
      expect(result).toBe('  PRIMARY KEY (`id`, `code`)');
    });
  });

  describe('generateForeignKeyConstraints', () => {
    it('should return empty array for no foreign keys', () => {
      expect(generateForeignKeyConstraints([], '`')).toEqual([]);
    });

    it('should generate single foreign key constraint', () => {
      const foreignKeys: ForeignKey[] = [
        { name: 'fk_user', column_name: 'user_id', ref_table: 'users', ref_column: 'id' },
      ];
      const result = generateForeignKeyConstraints(foreignKeys, '`');
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('  CONSTRAINT `fk_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)');
    });

    it('should generate multiple foreign key constraints', () => {
      const foreignKeys: ForeignKey[] = [
        { name: 'fk_user', column_name: 'user_id', ref_table: 'users', ref_column: 'id' },
        { name: 'fk_product', column_name: 'product_id', ref_table: 'products', ref_column: 'id' },
      ];
      const result = generateForeignKeyConstraints(foreignKeys, '`');
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('fk_user');
      expect(result[1]).toContain('fk_product');
    });

    it('should use double quotes for PostgreSQL', () => {
      const foreignKeys: ForeignKey[] = [
        { name: 'fk_user', column_name: 'user_id', ref_table: 'users', ref_column: 'id' },
      ];
      const result = generateForeignKeyConstraints(foreignKeys, '"');
      expect(result[0]).toBe('  CONSTRAINT "fk_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id")');
    });

    it('should handle foreign keys with underscore names', () => {
      const foreignKeys: ForeignKey[] = [
        { name: 'fk_user_profile_id', column_name: 'user_profile_id', ref_table: 'user_profiles', ref_column: 'profile_id' },
      ];
      const result = generateForeignKeyConstraints(foreignKeys, '`');
      expect(result[0]).toContain('`user_profile_id`');
      expect(result[0]).toContain('`user_profiles`');
    });
  });

  describe('generateIndexStatements', () => {
    const tableName = 'users';

    it('should return empty array for no indexes', () => {
      expect(generateIndexStatements([], tableName, '`')).toEqual([]);
    });

    it('should skip primary key indexes', () => {
      const indexes: Index[] = [
        { name: 'PRIMARY', column_name: 'id', is_unique: true, is_primary: true },
      ];
      expect(generateIndexStatements(indexes, tableName, '`')).toEqual([]);
    });

    it('should generate unique index statement', () => {
      const indexes: Index[] = [
        { name: 'uk_email', column_name: 'email', is_unique: true, is_primary: false },
      ];
      const result = generateIndexStatements(indexes, tableName, '`');
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('CREATE UNIQUE INDEX `uk_email` ON `users` (`email`);');
    });

    it('should generate non-unique index statement', () => {
      const indexes: Index[] = [
        { name: 'idx_name', column_name: 'name', is_unique: false, is_primary: false },
      ];
      const result = generateIndexStatements(indexes, tableName, '`');
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('CREATE INDEX `idx_name` ON `users` (`name`);');
    });

    it('should generate a single statement for composite indexes', () => {
      const indexes: Index[] = [
        { name: 'idx_orders_lookup', column_name: 'customer_id', is_unique: false, is_primary: false, seq_in_index: 1 },
        { name: 'idx_orders_lookup', column_name: 'status', is_unique: false, is_primary: false, seq_in_index: 2 },
        { name: 'idx_orders_lookup', column_name: 'created_at', is_unique: false, is_primary: false, seq_in_index: 3 },
        { name: 'idx_orders_lookup', column_name: 'id', is_unique: false, is_primary: false, seq_in_index: 4 },
      ];
      const result = generateIndexStatements(indexes, 'orders', '`');
      expect(result).toEqual([
        'CREATE INDEX `idx_orders_lookup` ON `orders` (`customer_id`, `status`, `created_at`, `id`);',
      ]);
    });

    it('should order composite index columns by sequence', () => {
      const indexes: Index[] = [
        { name: 'idx_orders_lookup', column_name: 'id', is_unique: false, is_primary: false, seq_in_index: 4 },
        { name: 'idx_orders_lookup', column_name: 'customer_id', is_unique: false, is_primary: false, seq_in_index: 1 },
        { name: 'idx_orders_lookup', column_name: 'created_at', is_unique: false, is_primary: false, seq_in_index: 3 },
        { name: 'idx_orders_lookup', column_name: 'status', is_unique: false, is_primary: false, seq_in_index: 2 },
      ];
      const result = generateIndexStatements(indexes, 'orders', '`');
      expect(result[0]).toBe(
        'CREATE INDEX `idx_orders_lookup` ON `orders` (`customer_id`, `status`, `created_at`, `id`);',
      );
    });

    it('should generate a single statement for composite unique indexes', () => {
      const indexes: Index[] = [
        { name: 'uk_user_email_scope', column_name: 'email', is_unique: true, is_primary: false, seq_in_index: 1 },
        { name: 'uk_user_email_scope', column_name: 'account_id', is_unique: true, is_primary: false, seq_in_index: 2 },
      ];
      const result = generateIndexStatements(indexes, tableName, '`');
      expect(result).toEqual([
        'CREATE UNIQUE INDEX `uk_user_email_scope` ON `users` (`email`, `account_id`);',
      ]);
    });

    it('should generate multiple index statements', () => {
      const indexes: Index[] = [
        { name: 'uk_email', column_name: 'email', is_unique: true, is_primary: false },
        { name: 'idx_name', column_name: 'name', is_unique: false, is_primary: false },
        { name: 'idx_created', column_name: 'created_at', is_unique: false, is_primary: false },
      ];
      const result = generateIndexStatements(indexes, tableName, '`');
      expect(result).toHaveLength(3);
      expect(result[0]).toContain('UNIQUE');
      expect(result[1]).not.toContain('UNIQUE');
      expect(result[2]).not.toContain('UNIQUE');
    });

    it('should use double quotes for PostgreSQL', () => {
      const indexes: Index[] = [
        { name: 'idx_name', column_name: 'name', is_unique: false, is_primary: false },
      ];
      const result = generateIndexStatements(indexes, tableName, '"');
      expect(result[0]).toBe('CREATE INDEX "idx_name" ON "users" ("name");');
    });

    it('should mix unique and non-unique indexes correctly', () => {
      const indexes: Index[] = [
        { name: 'PRIMARY', column_name: 'id', is_unique: true, is_primary: true },
        { name: 'uk_email', column_name: 'email', is_unique: true, is_primary: false },
        { name: 'idx_name', column_name: 'name', is_unique: false, is_primary: false },
      ];
      const result = generateIndexStatements(indexes, tableName, '`');
      expect(result).toHaveLength(2); // PRIMARY skipped
      expect(result[0]).toContain('UNIQUE');
      expect(result[1]).not.toContain('UNIQUE');
    });
  });

  describe('generateCreateTableSQL', () => {
    const columns: TableColumn[] = [
      { name: 'id', data_type: 'INT', is_pk: true, is_nullable: false, is_auto_increment: true, default_value: null },
      { name: 'name', data_type: 'VARCHAR(100)', is_pk: false, is_nullable: false, is_auto_increment: false, default_value: null },
      { name: 'email', data_type: 'VARCHAR(255)', is_pk: false, is_nullable: true, is_auto_increment: false, default_value: null },
    ];

    it('should generate complete CREATE TABLE for MySQL', () => {
      const result = generateCreateTableSQL('users', columns, [], [], 'mysql');
      expect(result).toContain('CREATE TABLE `users` (');
      expect(result).toContain('`id` INT NOT NULL AUTO_INCREMENT');
      expect(result).toContain('`name` VARCHAR(100) NOT NULL');
      expect(result).toContain('`email` VARCHAR(255)');
      expect(result).toContain('PRIMARY KEY (`id`)');
      expect(result).toContain(');');
    });

    it('should generate CREATE TABLE with foreign keys', () => {
      const foreignKeys: ForeignKey[] = [
        { name: 'fk_parent', column_name: 'parent_id', ref_table: 'parents', ref_column: 'id' },
      ];
      const result = generateCreateTableSQL('children', columns, foreignKeys, [], 'mysql');
      expect(result).toContain('CONSTRAINT `fk_parent` FOREIGN KEY (`parent_id`)');
      expect(result).toContain('REFERENCES `parents` (`id`)');
    });

    it('should generate CREATE TABLE with indexes', () => {
      const indexes: Index[] = [
        { name: 'idx_name', column_name: 'name', is_unique: false, is_primary: false },
      ];
      const result = generateCreateTableSQL('users', columns, [], indexes, 'mysql');
      expect(result).toContain('CREATE INDEX `idx_name` ON `users` (`name`);');
    });

    it('should generate CREATE TABLE with composite indexes', () => {
      const indexes: Index[] = [
        { name: 'idx_orders_lookup', column_name: 'customer_id', is_unique: false, is_primary: false, seq_in_index: 1 },
        { name: 'idx_orders_lookup', column_name: 'status', is_unique: false, is_primary: false, seq_in_index: 2 },
        { name: 'idx_orders_lookup', column_name: 'created_at', is_unique: false, is_primary: false, seq_in_index: 3 },
        { name: 'idx_orders_lookup', column_name: 'id', is_unique: false, is_primary: false, seq_in_index: 4 },
      ];
      const result = generateCreateTableSQL('orders', columns, [], indexes, 'mysql');
      expect(result).toContain(
        'CREATE INDEX `idx_orders_lookup` ON `orders` (`customer_id`, `status`, `created_at`, `id`);',
      );
      expect(result).not.toContain('CREATE INDEX `idx_orders_lookup` ON `orders` (`status`);');
    });

    it('should generate complete SQL for PostgreSQL', () => {
      const result = generateCreateTableSQL('users', columns, [], [], 'postgresql');
      expect(result).toContain('CREATE TABLE "users" (');
      expect(result).toContain('"id" SERIAL');
      expect(result).toContain('PRIMARY KEY ("id")');
    });

    it('should generate complete SQL for SQLite', () => {
      const result = generateCreateTableSQL('users', columns, [], [], 'sqlite');
      expect(result).toContain('CREATE TABLE "users" (');
      expect(result).toContain('INTEGER PRIMARY KEY AUTOINCREMENT');
      expect(result).not.toContain('PRIMARY KEY ("id")'); // SQLite handles PK in column def
    });

    it('should handle empty columns array', () => {
      const result = generateCreateTableSQL('empty', [], [], [], 'mysql');
      expect(result).toContain('CREATE TABLE `empty` (');
      expect(result).toContain(');');
    });

    it('should handle table names with special characters', () => {
      const result = generateCreateTableSQL('user_profiles', columns, [], [], 'mysql');
      expect(result).toContain('CREATE TABLE `user_profiles` (');
    });

    it('should handle all database drivers', () => {
      const drivers: DatabaseDriver[] = ['mysql', 'mariadb', 'postgresql', 'sqlite'];
      drivers.forEach(driver => {
        const result = generateCreateTableSQL('test', columns, [], [], driver);
        expect(result).toContain('CREATE TABLE');
        expect(result.length).toBeGreaterThan(0);
      });
    });

    it('should format with proper line breaks', () => {
      const result = generateCreateTableSQL('users', columns, [], [], 'mysql');
      const lines = result.split('\n');
      expect(lines[0]).toBe('CREATE TABLE `users` (');
      expect(lines[lines.length - 1]).toBe(');');
    });

    it('should separate indexes with blank line', () => {
      const indexes: Index[] = [
        { name: 'idx_name', column_name: 'name', is_unique: false, is_primary: false },
      ];
      const result = generateCreateTableSQL('users', columns, [], indexes, 'mysql');
      const parts = result.split('\n\n');
      expect(parts).toHaveLength(2);
    });
  });

  // CapabilityCapabilities-based API tests
  describe('getIdentifierQuote with DriverCapabilities', () => {
    it('should use identifier_quote from capabilities', () => {
      expect(getIdentifierQuote(makeCaps({ identifier_quote: '`' }))).toBe('`');
    });

    it('should default to double quote when identifier_quote is empty', () => {
      expect(getIdentifierQuote(makeCaps({ identifier_quote: '' }))).toBe('"');
    });

    it('should use double quote from capabilities', () => {
      expect(getIdentifierQuote(makeCaps({ identifier_quote: '"' }))).toBe('"');
    });
  });

  describe('generateColumnDefinition with DriverCapabilities', () => {
    const baseColumn: TableColumn = {
      name: 'id', data_type: 'INT', is_pk: true,
      is_nullable: false, is_auto_increment: false, default_value: null,
    };

    it('should use identifier_quote from capabilities', () => {
      const caps = makeCaps({ identifier_quote: '`' });
      const result = generateColumnDefinition(baseColumn, caps);
      expect(result).toBe('  `id` INT NOT NULL');
    });

    it('should append auto_increment_keyword when set', () => {
      const caps = makeCaps({ identifier_quote: '`', auto_increment_keyword: 'AUTO_INCREMENT' });
      const col = { ...baseColumn, is_auto_increment: true };
      const result = generateColumnDefinition(col, caps);
      expect(result).toContain('AUTO_INCREMENT');
    });

    it('should replace type with serial_type for auto-increment', () => {
      const caps = makeCaps({ identifier_quote: '"', serial_type: 'SERIAL' });
      const col = { ...baseColumn, is_auto_increment: true };
      const result = generateColumnDefinition(col, caps);
      expect(result).toContain('SERIAL');
      expect(result).not.toContain('INT');
    });

    it('should use inline_pk style for auto-increment', () => {
      const caps = makeCaps({
        identifier_quote: '"', inline_pk: true, auto_increment_keyword: 'AUTOINCREMENT',
      });
      const col = { ...baseColumn, is_auto_increment: true };
      const result = generateColumnDefinition(col, caps);
      expect(result).toContain('INTEGER PRIMARY KEY AUTOINCREMENT');
    });

    it('should produce no auto-increment syntax when all capabilities are empty', () => {
      const caps = makeCaps({ identifier_quote: '"' });
      const col = { ...baseColumn, is_auto_increment: true };
      const result = generateColumnDefinition(col, caps);
      expect(result).not.toContain('AUTO_INCREMENT');
      expect(result).not.toContain('SERIAL');
      expect(result).not.toContain('AUTOINCREMENT');
    });
  });

  describe('generatePrimaryKeyConstraint with DriverCapabilities', () => {
    const pkColumns: TableColumn[] = [
      { name: 'id', data_type: 'INT', is_pk: true, is_nullable: false, is_auto_increment: false, default_value: null },
    ];

    it('should return null when inline_pk is true', () => {
      const caps = makeCaps({ identifier_quote: '"', inline_pk: true });
      expect(generatePrimaryKeyConstraint(pkColumns, caps)).toBeNull();
    });

    it('should return constraint when inline_pk is false', () => {
      const caps = makeCaps({ identifier_quote: '"', inline_pk: false });
      const result = generatePrimaryKeyConstraint(pkColumns, caps);
      expect(result).toBe('  PRIMARY KEY ("id")');
    });

    it('should use identifier_quote from capabilities for PK constraint', () => {
      const caps = makeCaps({ identifier_quote: '`', inline_pk: false });
      const result = generatePrimaryKeyConstraint(pkColumns, caps);
      expect(result).toBe('  PRIMARY KEY (`id`)');
    });

    it('should return null when no pk columns even with capabilities', () => {
      const noPkCols: TableColumn[] = [
        { name: 'name', data_type: 'VARCHAR', is_pk: false, is_nullable: true, is_auto_increment: false, default_value: null },
      ];
      const caps = makeCaps({ identifier_quote: '"' });
      expect(generatePrimaryKeyConstraint(noPkCols, caps)).toBeNull();
    });
  });

  describe('generateCreateTableSQL with DriverCapabilities', () => {
    const columns: TableColumn[] = [
      { name: 'id', data_type: 'INT', is_pk: true, is_nullable: false, is_auto_increment: true, default_value: null },
      { name: 'name', data_type: 'VARCHAR(100)', is_pk: false, is_nullable: false, is_auto_increment: false, default_value: null },
    ];

    it('should generate SQL for mysql-like capabilities', () => {
      const caps = makeCaps({
        identifier_quote: '`',
        auto_increment_keyword: 'AUTO_INCREMENT',
        inline_pk: false,
      });
      const result = generateCreateTableSQL('users', columns, [], [], caps);
      expect(result).toContain('CREATE TABLE `users` (');
      expect(result).toContain('`id` INT NOT NULL AUTO_INCREMENT');
      expect(result).toContain('PRIMARY KEY (`id`)');
    });

    it('should generate SQL for postgresql-like capabilities', () => {
      const caps = makeCaps({
        identifier_quote: '"',
        serial_type: 'SERIAL',
        inline_pk: false,
      });
      const result = generateCreateTableSQL('users', columns, [], [], caps);
      expect(result).toContain('CREATE TABLE "users" (');
      expect(result).toContain('"id" SERIAL');
      expect(result).toContain('PRIMARY KEY ("id")');
    });

    it('should generate SQL for sqlite-like capabilities', () => {
      const caps = makeCaps({
        identifier_quote: '"',
        auto_increment_keyword: 'AUTOINCREMENT',
        inline_pk: true,
      });
      const result = generateCreateTableSQL('users', columns, [], [], caps);
      expect(result).toContain('CREATE TABLE "users" (');
      expect(result).toContain('INTEGER PRIMARY KEY AUTOINCREMENT');
      expect(result).not.toContain('PRIMARY KEY ("id")');
    });

    it('should generate SQL for unknown driver with no auto-increment capabilities', () => {
      const caps = makeCaps({ identifier_quote: '"' });
      const result = generateCreateTableSQL('items', columns, [], [], caps);
      expect(result).toContain('CREATE TABLE "items" (');
      expect(result).not.toContain('AUTO_INCREMENT');
      expect(result).not.toContain('SERIAL');
      expect(result).not.toContain('AUTOINCREMENT');
    });
  });
});
