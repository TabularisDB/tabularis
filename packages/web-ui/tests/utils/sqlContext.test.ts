import { describe, it, expect } from 'vitest';
import {
  analyzeSqlContext,
  findStatementScopeEnd,
  getKeywordRelevance,
  getSuggestionKinds,
  SQL_CLAUSES,
  type SqlClause,
} from '../../src/utils/sqlContext';

// Convenience: analyze with the cursor at the end of the given text.
const clauseOf = (text: string): SqlClause => analyzeSqlContext(text).clause;

describe('sqlContext', () => {
  describe('analyzeSqlContext - clause detection', () => {
    it('reports start on an empty buffer', () => {
      expect(clauseOf('')).toBe('start');
      expect(clauseOf('   \n  ')).toBe('start');
    });

    it('reports start while typing the first word', () => {
      // A partial word is an identifier, not a clause keyword.
      expect(clauseOf('SEL')).toBe('start');
    });

    it('reports select inside the SELECT list', () => {
      expect(clauseOf('SELECT ')).toBe('select');
      expect(clauseOf('SELECT id, na')).toBe('select');
      expect(clauseOf('select distinct ')).toBe('select');
    });

    it('reports from after FROM', () => {
      expect(clauseOf('SELECT * FROM ')).toBe('from');
      expect(clauseOf('SELECT * FROM use')).toBe('from');
      expect(clauseOf('SELECT * FROM db.')).toBe('from');
    });

    it('reports join after any JOIN variant', () => {
      expect(clauseOf('SELECT * FROM a JOIN ')).toBe('join');
      expect(clauseOf('SELECT * FROM a LEFT JOIN ')).toBe('join');
      expect(clauseOf('SELECT * FROM a LEFT OUTER JOIN ')).toBe('join');
      expect(clauseOf('SELECT * FROM a CROSS JOIN ')).toBe('join');
    });

    it('reports on inside a join condition', () => {
      expect(clauseOf('SELECT * FROM a JOIN b ON ')).toBe('on');
      expect(clauseOf('SELECT * FROM a JOIN b ON a.id = b.a_id AND ')).toBe('on');
    });

    it('reports using after USING', () => {
      expect(clauseOf('SELECT * FROM a JOIN b USING ')).toBe('using');
    });

    it('reports where inside WHERE conditions', () => {
      expect(clauseOf('SELECT * FROM t WHERE ')).toBe('where');
      expect(clauseOf('SELECT * FROM t WHERE a = 1 AND ')).toBe('where');
      expect(clauseOf('SELECT * FROM t WHERE a = 1 OR NOT ')).toBe('where');
      expect(clauseOf('SELECT * FROM t WHERE (a = 1 AND ')).toBe('where');
    });

    it('reports group-by / order-by / window from two-word keywords', () => {
      expect(clauseOf('SELECT * FROM t GROUP BY ')).toBe('group-by');
      expect(clauseOf('SELECT * FROM t ORDER BY ')).toBe('order-by');
      expect(clauseOf('SELECT rank() OVER (PARTITION BY ')).toBe('window');
    });

    it('does not treat a lone BY as a clause change', () => {
      expect(clauseOf('SELECT * FROM t WHERE by ')).toBe('where');
    });

    it('reports having after HAVING', () => {
      expect(clauseOf('SELECT a FROM t GROUP BY a HAVING ')).toBe('having');
    });

    it('reports limit after LIMIT / OFFSET / FETCH', () => {
      expect(clauseOf('SELECT * FROM t LIMIT ')).toBe('limit');
      expect(clauseOf('SELECT * FROM t LIMIT 10 OFFSET ')).toBe('limit');
      expect(clauseOf('SELECT * FROM t FETCH ')).toBe('limit');
    });

    it('reports update and set for UPDATE statements', () => {
      expect(clauseOf('UPDATE ')).toBe('update');
      expect(clauseOf('UPDATE users SET ')).toBe('set');
      expect(clauseOf('UPDATE users SET name = 1, ')).toBe('set');
    });

    it('reports where in an UPDATE with WHERE', () => {
      expect(clauseOf('UPDATE users SET a = 1 WHERE ')).toBe('where');
    });

    it('reports delete before FROM and from after it', () => {
      expect(clauseOf('DELETE ')).toBe('delete');
      expect(clauseOf('DELETE FROM ')).toBe('from');
    });

    it('reports insert-into after INSERT and INTO', () => {
      expect(clauseOf('INSERT ')).toBe('insert-into');
      expect(clauseOf('INSERT INTO ')).toBe('insert-into');
      expect(clauseOf('REPLACE ')).toBe('insert-into');
    });

    it('reports insert-columns inside the INSERT column list', () => {
      expect(clauseOf('INSERT INTO users (')).toBe('insert-columns');
      expect(clauseOf('INSERT INTO users (id, na')).toBe('insert-columns');
      expect(clauseOf('INSERT INTO "users" (')).toBe('insert-columns');
    });

    it('reports values inside VALUES', () => {
      expect(clauseOf('INSERT INTO users (id) VALUES ')).toBe('values');
      expect(clauseOf('INSERT INTO users (id) VALUES (')).toBe('values');
    });

    it('reports case inside CASE expressions and restores on END', () => {
      expect(clauseOf('SELECT CASE ')).toBe('case');
      expect(clauseOf('SELECT CASE WHEN a = 1 THEN ')).toBe('case');
      expect(clauseOf('SELECT CASE WHEN a = 1 THEN 2 ELSE ')).toBe('case');
      expect(clauseOf('SELECT CASE WHEN a THEN 1 END, ')).toBe('select');
    });

    it('handles nested CASE expressions', () => {
      expect(clauseOf('SELECT CASE WHEN a THEN CASE WHEN b THEN 1 END ')).toBe('case');
      expect(clauseOf('SELECT CASE WHEN a THEN CASE WHEN b THEN 1 END ELSE 2 END ')).toBe('select');
    });

    it('reports function-args inside function calls', () => {
      expect(clauseOf('SELECT count(')).toBe('function-args');
      expect(clauseOf('SELECT coalesce(a, ')).toBe('function-args');
      expect(clauseOf('SELECT * FROM t WHERE lower(')).toBe('function-args');
    });

    it('restores the outer clause after a function call closes', () => {
      expect(clauseOf('SELECT count(id) ')).toBe('select');
      expect(clauseOf('SELECT * FROM t WHERE lower(name) = ')).toBe('where');
    });

    it('reports in-list inside IN (...)', () => {
      expect(clauseOf('SELECT * FROM t WHERE id IN (')).toBe('in-list');
      expect(clauseOf('SELECT * FROM t WHERE id IN (1, ')).toBe('in-list');
    });

    it('switches to select inside an IN subquery', () => {
      expect(clauseOf('SELECT * FROM t WHERE id IN (SELECT ')).toBe('select');
      expect(clauseOf('SELECT * FROM t WHERE id IN (SELECT x FROM ')).toBe('from');
    });

    it('tracks subqueries in FROM and restores after they close', () => {
      expect(clauseOf('SELECT * FROM (SELECT ')).toBe('select');
      expect(clauseOf('SELECT * FROM (SELECT id FROM inner_t) ')).toBe('from');
    });

    it('inherits the clause inside plain expression groups', () => {
      expect(clauseOf('SELECT (a + ')).toBe('select');
      expect(clauseOf('SELECT * FROM t WHERE (')).toBe('where');
    });

    it('reports union between set operations and select after it', () => {
      expect(clauseOf('SELECT a FROM t UNION ')).toBe('union');
      expect(clauseOf('SELECT a FROM t UNION ALL ')).toBe('union');
      expect(clauseOf('SELECT a FROM t UNION SELECT ')).toBe('select');
      expect(clauseOf('SELECT a FROM t INTERSECT ')).toBe('union');
      expect(clauseOf('SELECT a FROM t EXCEPT ')).toBe('union');
    });

    it('reports DDL clauses', () => {
      expect(clauseOf('CREATE ')).toBe('create');
      expect(clauseOf('CREATE TABLE ')).toBe('create');
      expect(clauseOf('DROP TABLE ')).toBe('drop');
      expect(clauseOf('ALTER TABLE ')).toBe('alter');
      expect(clauseOf('TRUNCATE ')).toBe('truncate');
      expect(clauseOf('DROP TABLE IF EXISTS ')).toBe('drop');
    });

    it('reports returning after RETURNING', () => {
      expect(clauseOf('DELETE FROM t WHERE id = 1 RETURNING ')).toBe('returning');
    });

    it('handles WITH and CTE bodies', () => {
      expect(clauseOf('WITH ')).toBe('with');
      expect(clauseOf('WITH x AS (')).toBe('start');
      expect(clauseOf('WITH x AS (SELECT ')).toBe('select');
      expect(clauseOf('WITH x AS (SELECT 1) ')).toBe('with');
      expect(clauseOf('WITH x AS (SELECT 1) SELECT * FROM ')).toBe('from');
    });

    it('resets state at statement separators', () => {
      expect(clauseOf('SELECT * FROM t; ')).toBe('start');
      expect(clauseOf('SELECT * FROM t; SELECT ')).toBe('select');
      expect(clauseOf('SELECT * FROM t WHERE (a = 1; UPDATE ')).toBe('update');
    });

    it('ignores keywords inside string literals', () => {
      expect(clauseOf("SELECT 'FROM WHERE' ")).toBe('select');
      expect(clauseOf("SELECT * FROM t WHERE a = 'DROP TABLE x' AND ")).toBe('where');
    });

    it('ignores keywords inside comments', () => {
      expect(clauseOf('SELECT 1 -- WHERE nothing\n')).toBe('select');
      expect(clauseOf('SELECT /* FROM t WHERE */ ')).toBe('select');
    });

    it('treats quoted identifiers as opaque identifiers', () => {
      expect(clauseOf('SELECT * FROM "my table" WHERE ')).toBe('where');
      expect(clauseOf('SELECT * FROM `from` WHERE ')).toBe('where');
      expect(clauseOf('SELECT * FROM [select] WHERE ')).toBe('where');
      // A quoted identifier before `(` reads as a function call.
      expect(clauseOf('SELECT "my func"(')).toBe('function-args');
    });

    it('is case-insensitive for keywords', () => {
      expect(clauseOf('select * from t where ')).toBe('where');
      expect(clauseOf('Select * From t Group By ')).toBe('group-by');
    });
  });

  describe('analyzeSqlContext - string and comment guards', () => {
    it('detects an open single-quoted string', () => {
      expect(analyzeSqlContext("SELECT 'hel").inString).toBe(true);
      expect(analyzeSqlContext("SELECT 'hello' ").inString).toBe(false);
    });

    it('honors doubled-quote escaping inside strings', () => {
      expect(analyzeSqlContext("SELECT 'it''s ").inString).toBe(true);
      expect(analyzeSqlContext("SELECT 'it''s' ").inString).toBe(false);
    });

    it('honors backslash escaping inside strings', () => {
      expect(analyzeSqlContext("SELECT 'a\\'b").inString).toBe(true);
      expect(analyzeSqlContext("SELECT 'a\\'b'").inString).toBe(false);
    });

    it('detects line comments until the newline', () => {
      expect(analyzeSqlContext('SELECT 1 -- note').inComment).toBe(true);
      expect(analyzeSqlContext('SELECT 1 -- note\n').inComment).toBe(false);
    });

    it('detects unterminated block comments', () => {
      expect(analyzeSqlContext('SELECT /* note').inComment).toBe(true);
      expect(analyzeSqlContext('SELECT /* note */ ').inComment).toBe(false);
    });

    it('does not flag quoted identifiers as strings', () => {
      expect(analyzeSqlContext('SELECT "col').inString).toBe(false);
      expect(analyzeSqlContext('SELECT `col').inString).toBe(false);
    });

    it('ignores comment markers inside strings and vice versa', () => {
      expect(analyzeSqlContext("SELECT '--not a comment'").inComment).toBe(false);
      expect(analyzeSqlContext("SELECT /* 'not a string */ ").inString).toBe(false);
    });
  });

  describe('analyzeSqlContext - nesting level', () => {
    it('is 0 at the top level', () => {
      expect(analyzeSqlContext('SELECT * FROM t WHERE ').nestingLevel).toBe(0);
    });

    it('increments per open parenthesis and decrements on close', () => {
      expect(analyzeSqlContext('SELECT (').nestingLevel).toBe(1);
      expect(analyzeSqlContext('SELECT (a + (').nestingLevel).toBe(2);
      expect(analyzeSqlContext('SELECT (a + (b)) ').nestingLevel).toBe(0);
    });

    it('never goes below 0 on unbalanced closes', () => {
      expect(analyzeSqlContext('SELECT a) ) ').nestingLevel).toBe(0);
    });
  });

  describe('analyzeSqlContext - statement scope', () => {
    it('is 0 at the top level', () => {
      expect(analyzeSqlContext('SELECT * FROM t WHERE ').statementStart).toBe(0);
    });

    it('starts after the last top-level semicolon', () => {
      const text = 'SELECT 1; SELECT * FROM ';
      expect(analyzeSqlContext(text).statementStart).toBe(text.indexOf(';') + 1);
    });

    it('starts after the ( of a FROM subquery', () => {
      const text = 'SELECT * FROM (SELECT id FROM ';
      expect(analyzeSqlContext(text).statementStart).toBe(text.indexOf('(') + 1);
    });

    it('starts after the ( of an IN subquery', () => {
      const text = 'SELECT * FROM sessions WHERE id IN (SELECT session_id FROM ';
      expect(analyzeSqlContext(text).statementStart).toBe(text.indexOf('(') + 1);
    });

    it('starts after the ( of a CTE body once its statement begins', () => {
      const text = 'WITH x AS (SELECT a FROM ';
      expect(analyzeSqlContext(text).statementStart).toBe(text.indexOf('(') + 1);
    });

    it('tracks the innermost of nested subqueries', () => {
      const text = 'SELECT * FROM (SELECT * FROM (SELECT id FROM ';
      expect(analyzeSqlContext(text).statementStart).toBe(text.lastIndexOf('(') + 1);
    });

    it('does not narrow for expression groups or function args', () => {
      expect(analyzeSqlContext('SELECT * FROM t WHERE (a = 1 AND ').statementStart).toBe(0);
      expect(analyzeSqlContext('SELECT count(').statementStart).toBe(0);
      expect(analyzeSqlContext('INSERT INTO t (id) VALUES (').statementStart).toBe(0);
    });

    it('does not narrow for a plain IN value list', () => {
      expect(analyzeSqlContext('SELECT * FROM t WHERE id IN (1, ').statementStart).toBe(0);
    });

    it('restores the outer scope after a subquery closes', () => {
      expect(analyzeSqlContext('SELECT * FROM (SELECT id FROM u) x WHERE ').statementStart).toBe(0);
    });

    it('does not treat FOR UPDATE as a statement boundary', () => {
      const text = 'SELECT * FROM (SELECT id FROM u FOR UPDATE';
      expect(analyzeSqlContext(text).statementStart).toBe(text.indexOf('(') + 1);
    });
  });

  describe('findStatementScopeEnd', () => {
    it('returns the text length when nothing closes the scope', () => {
      expect(findStatementScopeEnd('WHERE a = 1', 0)).toBe(11);
    });

    it('stops at the unmatched closing parenthesis', () => {
      const text = 'FROM inner_t) outer_rest';
      expect(findStatementScopeEnd(text, 0)).toBe(text.indexOf(')'));
    });

    it('skips balanced pairs before the scope close', () => {
      const text = 'FROM t WHERE f(a, b) > 1) rest';
      expect(findStatementScopeEnd(text, 0)).toBe(text.lastIndexOf(')'));
    });

    it('stops at a top-level semicolon', () => {
      const text = 'FROM t; SELECT 1';
      expect(findStatementScopeEnd(text, 0)).toBe(text.indexOf(';'));
    });

    it('ignores parentheses and semicolons inside strings and comments', () => {
      const text = "FROM t WHERE a = ');' -- );\n)";
      expect(findStatementScopeEnd(text, 0)).toBe(text.length - 1);
    });

    it('starts scanning from the given offset', () => {
      const text = '(inner) outer)';
      expect(findStatementScopeEnd(text, 7)).toBe(text.length - 1);
    });
  });

  describe('getSuggestionKinds', () => {
    it('covers every clause the analyzer can produce', () => {
      for (const clause of SQL_CLAUSES) {
        const kinds = getSuggestionKinds(clause);
        expect(kinds).toBeDefined();
        expect(typeof kinds.columns).toBe('boolean');
        expect(typeof kinds.tables).toBe('boolean');
        expect(typeof kinds.keywords).toBe('boolean');
      }
    });

    it('suggests tables but not columns in table-position clauses', () => {
      for (const clause of ['from', 'join', 'update', 'insert-into'] as const) {
        expect(getSuggestionKinds(clause)).toMatchObject({ tables: true, columns: false });
      }
    });

    it('suggests columns but not tables in expression clauses', () => {
      for (const clause of [
        'select', 'where', 'on', 'using', 'group-by', 'having', 'order-by',
        'set', 'case', 'function-args', 'in-list', 'window', 'returning',
      ] as const) {
        expect(getSuggestionKinds(clause)).toMatchObject({ columns: true, tables: false });
      }
    });

    it('suggests only columns inside INSERT column lists', () => {
      expect(getSuggestionKinds('insert-columns')).toEqual({
        columns: true,
        tables: false,
        keywords: false,
      });
    });

    it('suggests only keywords at statement boundaries', () => {
      for (const clause of ['start', 'union', 'with', 'delete', 'values', 'limit', 'create'] as const) {
        expect(getSuggestionKinds(clause)).toMatchObject({
          columns: false,
          tables: false,
          keywords: true,
        });
      }
    });

    it('allows everything for unknown so misses degrade gracefully', () => {
      expect(getSuggestionKinds('unknown')).toEqual({
        columns: true,
        tables: true,
        keywords: true,
      });
    });
  });

  describe('getKeywordRelevance', () => {
    it('hides WHEN outside CASE so "wh" selects WHERE', () => {
      expect(getKeywordRelevance('from', 'WHEN')).toBe('hidden');
      expect(getKeywordRelevance('from', 'WHERE')).toBe('high');
      expect(getKeywordRelevance('where', 'WHEN')).toBe('hidden');
      expect(getKeywordRelevance('select', 'WHEN')).toBe('hidden');
    });

    it('shows CASE-only keywords inside CASE, boosted', () => {
      for (const kw of ['WHEN', 'THEN', 'ELSE', 'END']) {
        expect(getKeywordRelevance('case', kw)).toBe('high');
      }
    });

    it('restricts ON to join conditions and upsert clauses', () => {
      expect(getKeywordRelevance('join', 'ON')).toBe('high');
      expect(getKeywordRelevance('values', 'ON')).toBe('normal');
      expect(getKeywordRelevance('select', 'ON')).toBe('hidden');
      expect(getKeywordRelevance('where', 'ON')).toBe('hidden');
    });

    it('restricts VALUES, SET, and INTO to their statements', () => {
      expect(getKeywordRelevance('insert-into', 'VALUES')).toBe('high');
      expect(getKeywordRelevance('where', 'VALUES')).toBe('hidden');
      expect(getKeywordRelevance('update', 'SET')).toBe('high');
      expect(getKeywordRelevance('from', 'SET')).toBe('hidden');
      expect(getKeywordRelevance('insert-into', 'INTO')).toBe('high');
      expect(getKeywordRelevance('order-by', 'INTO')).toBe('hidden');
    });

    it('boosts likely continuations per clause', () => {
      expect(getKeywordRelevance('start', 'SELECT')).toBe('high');
      expect(getKeywordRelevance('select', 'FROM')).toBe('high');
      expect(getKeywordRelevance('from', 'GROUP BY')).toBe('high');
      expect(getKeywordRelevance('where', 'AND')).toBe('high');
      expect(getKeywordRelevance('group-by', 'HAVING')).toBe('high');
      expect(getKeywordRelevance('order-by', 'LIMIT')).toBe('high');
      expect(getKeywordRelevance('delete', 'FROM')).toBe('high');
      expect(getKeywordRelevance('in-list', 'SELECT')).toBe('high');
      expect(getKeywordRelevance('union', 'SELECT')).toBe('high');
    });

    it('leaves unrelated keywords at normal relevance', () => {
      expect(getKeywordRelevance('select', 'COUNT')).toBe('normal');
      expect(getKeywordRelevance('from', 'SELECT')).toBe('normal');
      expect(getKeywordRelevance('where', 'CASE')).toBe('normal');
    });

    it('never hides or boosts anything for unknown', () => {
      for (const kw of ['WHEN', 'ON', 'VALUES', 'WHERE', 'SELECT']) {
        expect(getKeywordRelevance('unknown', kw)).toBe('normal');
      }
    });
  });
});
