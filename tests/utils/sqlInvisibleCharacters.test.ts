import { describe, expect, it } from 'vitest';
import {
  cleanSqlInvisibleCharacters,
  getSqlInvisibleCharacterEdits,
} from '../../src/utils/sqlInvisibleCharacters';

describe('cleanSqlInvisibleCharacters', () => {
  it('removes invisible characters from SQL code but keeps layout', () => {
    const dirty = '\uFEFFSELECT\u200B\tname\u202E\nFROM\u2066 users\u2069;';
    expect(cleanSqlInvisibleCharacters(dirty, 'postgres')).toBe('SELECT\tname\nFROM users;');
  });

  it('normalizes pasted quote delimiters, spaces and wide punctuation', () => {
    const dirty = 'SELECT\u00A0\u201Cname\u201D，\u2018bob\u2019\u202FFROM（users）；';
    expect(cleanSqlInvisibleCharacters(dirty, 'postgres'))
      .toBe('SELECT "name",\'bob\' FROM(users);');
    expect(cleanSqlInvisibleCharacters('SELECT\u2000a！', 'postgres')).toBe('SELECT a!');
  });

  it('does not modify SQL string literals, quoted identifiers, or comments', () => {
    const sql = [
      "SELECT 'It’s O’Brien', '你好，世界', '👨‍👩‍👧',",
      '       "col\u200Bname", \u201Cid\u201D FROM users;',
      '-- Keep \u200B and \u201C inside comments',
    ].join('\n');
    const expected = sql.replace('\u201Cid\u201D', '"id"');
    expect(cleanSqlInvisibleCharacters(sql, 'postgres')).toBe(expected);
  });

  it('uses dialect-specific quote rules, including MySQL backticks', () => {
    const sql = "SELECT \u0060it’s\u0060, 'Persian\u200Ctext', 'a\\'b', \u2018clean\u2019；";
    const expected = "SELECT \u0060it’s\u0060, 'Persian\u200Ctext', 'a\\'b', 'clean';";
    expect(cleanSqlInvisibleCharacters(sql, 'mysql')).toBe(expected);
  });

  it('reports changes in original document offsets for editor selections', () => {
    const sql = "SELECT 'value\u200B', \u201Cid\u201D, col\u200B;";
    const edits = getSqlInvisibleCharacterEdits(sql, 'postgres');
    expect(edits.map((edit) => sql.slice(edit.start, edit.end)))
      .toEqual(['\u201C', '\u201D', '\u200B']);
    expect(edits.map((edit) => edit.text)).toEqual(['"', '"', '']);
  });

  it('keeps ordinary non-ASCII data and is idempotent', () => {
    const sql = "SELECT 'café', '東京', amount FROM sales;";
    expect(cleanSqlInvisibleCharacters(sql, 'postgres')).toBe(sql);
    const once = cleanSqlInvisibleCharacters('SELECT\u200B\u00A0\u2018id\u2019', 'postgres');
    expect(cleanSqlInvisibleCharacters(once, 'postgres')).toBe(once);
  });

  it('retains the original fallback for an unknown dialect', () => {
    expect(cleanSqlInvisibleCharacters("SELECT 'a\u200Bb'"))
      .toBe("SELECT 'ab'");
  });
});
