import { describe, expect, it } from 'vitest';
import { cleanSqlInvisibleCharacters } from '../../src/utils/sqlInvisibleCharacters';

describe('cleanSqlInvisibleCharacters', () => {
  it('removes zero-width, BOM and bidi controls without changing line breaks or tabs', () => {
    const dirty = '\uFEFFSELECT\u200B\u200D\tname\u202E\nFROM\u2066 users\u2069;';
    expect(cleanSqlInvisibleCharacters(dirty)).toBe('SELECT\tname\nFROM users;');
  });

  it('normalizes typographic quotes, non-breaking spaces and full-width punctuation', () => {
    const dirty = 'SELECT\u00A0\u201Cname\u201D，\u2018O\u2019Brien\u2019\u202FFROM（users）；';
    expect(cleanSqlInvisibleCharacters(dirty)).toBe('SELECT "name",\'O\'Brien\' FROM(users);');
  });

  it('keeps ordinary non-ASCII data and is idempotent', () => {
    const sql = "SELECT 'café', '東京', amount FROM sales;";
    expect(cleanSqlInvisibleCharacters(sql)).toBe(sql);
    const once = cleanSqlInvisibleCharacters('SELECT\u200B\u00A0\u2018id\u2019');
    expect(cleanSqlInvisibleCharacters(once)).toBe(once);
  });
});
