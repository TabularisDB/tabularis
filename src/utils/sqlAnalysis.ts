// SQL Analysis Utilities - Pure logic functions for parsing and analyzing SQL

export interface ParsedTableRef {
  name: string;
  schema?: string;
}

// Isolate the FROM/JOIN section of a SQL statement so clause keywords
// (WHERE, HAVING, etc.) are never present when the alias-capture regex runs.
const extractFromSection = (sql: string): string => {
  const fromIdx = sql.toLowerCase().search(/\bfrom\b/);
  if (fromIdx === -1) return '';

  const fromText = sql.slice(fromIdx);
  // Stop at the first clause that cannot appear inside a FROM/JOIN list
  const boundary = /\b(?:where|group\s+by|order\s+by|having|limit|offset|union|intersect|except)\b/i.exec(fromText);
  const section = boundary ? fromText.slice(0, boundary.index) : fromText;

  // Strip ON <cond> and USING(...) within JOIN clauses so those keywords
  // are not captured as table aliases.
  return section
    .replace(/\bon\b.+?(?=\b(?:join|left|right|inner|outer|cross|natural)\b|$)/gis, ' ')
    .replace(/\busing\s*\([^)]*\)/gi, ' ');
};

// Optimized table parser - returns alias → ParsedTableRef.
// Handles both unqualified (table) and qualified (schema.table) references.
export const parseTablesFromQuery = (sql: string): Map<string, ParsedTableRef> | null => {
  if (!sql || sql.length === 0) return null;

  const fromSection = extractFromSection(sql);
  if (!fromSection) return null;

  const tableMap = new Map<string, ParsedTableRef>();
  // Groups: 1=first-id (schema when group 2 present, else table), 2=table (qualified), 3=alias.
  // The negative-lookahead stops the optional alias group from swallowing a keyword that
  // legally follows a table name (JOIN/LEFT/NATURAL/FOR/…). Without it the keyword is both
  // mis-registered as an alias and consumed, dropping the table that follows it.
  const fromPattern = /(?:from|join)\s+`?([a-z_][a-z0-9_]*)`?(?:\.`?([a-z_][a-z0-9_]*)`?)?(?:\s+(?:as\s+)?`?(?!(?:join|left|right|inner|outer|cross|natural|full|on|using|where|group|order|having|limit|offset|union|intersect|except|for|fetch|window|lateral|tablesample|qualify|straight_join)\b)([a-z_][a-z0-9_]*)`?)?/gi;

  let match;
  let matchCount = 0;
  const MAX_MATCHES = 10;

  while ((match = fromPattern.exec(fromSection.toLowerCase())) !== null && matchCount++ < MAX_MATCHES) {
    const qualified = !!match[2];
    const tableName = qualified ? match[2] : match[1];
    const schema = qualified ? match[1] : undefined;
    const alias = match[3] || tableName;
    tableMap.set(alias, { name: tableName, schema });
  }

  return tableMap.size > 0 ? tableMap : null;
};

// Optimized statement extractor - avoid full text scan when possible
export const getCurrentStatement = (model: { getValue: () => string; getOffsetAt: (position: { lineNumber: number; column: number }) => number }, position: { lineNumber: number; column: number }): string => {
  const fullText = model.getValue();
  
  // For small files, just return full text
  if (fullText.length < 500) {
    return fullText;
  }
  
  const offset = model.getOffsetAt(position);
  let start = 0;
  let end = fullText.length;
  
  // Search within reasonable bounds (±2000 chars from cursor)
  const searchStart = Math.max(0, offset - 2000);
  const searchEnd = Math.min(fullText.length, offset + 2000);
  
  // Find previous semicolon
  for (let i = offset - 1; i >= searchStart; i--) {
    if (fullText[i] === ';') {
      start = i + 1;
      break;
    }
  }
  
  // Find next semicolon
  for (let i = offset; i < searchEnd; i++) {
    if (fullText[i] === ';') {
      end = i;
      break;
    }
  }
  
  return fullText.substring(start, end).trim();
};
