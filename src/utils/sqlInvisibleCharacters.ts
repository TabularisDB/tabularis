import { scanNonCodeSpans, type Dialect } from './sqlSplitter';

/** A replacement in the original SQL text, using UTF-16 offsets. */
export interface SqlCharacterCleanupEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Characters that are not normally visible in pasted SQL code. */
const CLEANUP_CHARACTERS =
  // Each match is one code point. Some of these characters combine with others.
  // eslint-disable-next-line no-misleading-character-class
  /[\u00A0\u00AD\u034F\u061C\u180E\u2000-\u200F\u2028\u2029\u202A-\u202F\u2060\u2066-\u2069\u3000\u3164\uFEFF\u2018-\u201F，；：（）＝．＋－＊／！]/g;

const WIDE_PUNCTUATION: Record<string, string> = {
  '，': ',', '；': ';', '：': ':', '（': '(', '）': ')',
  '＝': '=', '．': '.', '＋': '+', '－': '-', '＊': '*', '／': '/', '！': '!',
};

function replacementFor(character: string): string {
  // Each match is one code point. Do not match a complete text cluster.
  // eslint-disable-next-line no-misleading-character-class
  if (/[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/.test(character)) {
    return '';
  }
  if (/[\u00A0\u2000-\u200A\u2028\u2029\u202F\u3000\u3164]/.test(character)) {
    return ' ';
  }
  if (/[\u2018-\u201B]/.test(character)) return "'";
  if (/[\u201C-\u201F]/.test(character)) return '"';
  return WIDE_PUNCTUATION[character] ?? character;
}

/**
 * Find changes in SQL code. Do not change quoted values, identifiers, or
 * comments. The SQL splitter supplies quote rules for the active dialect.
 * Missing or unrecognized dialects use conservative generic quote rules.
 */
export function getSqlInvisibleCharacterEdits(
  text: string,
  dialect?: Dialect | string,
): SqlCharacterCleanupEdit[] {
  // The action is exposed in notebook and modal editors without a dialect.
  // Default to conservative generic parsing rather than mutating SQL literals.
  const supportedDialects: ReadonlySet<string> = new Set([
    'postgres', 'mysql', 'mssql', 'sqlite', 'oracle', 'generic',
  ]);
  const cleanupDialect = dialect && supportedDialects.has(dialect) ? dialect : 'generic';
  const nonCodeSpans = scanNonCodeSpans(text, cleanupDialect);
  const edits: SqlCharacterCleanupEdit[] = [];
  let spanIndex = 0;

  for (const match of text.matchAll(CLEANUP_CHARACTERS)) {
    const start = match.index;
    while (spanIndex < nonCodeSpans.length && nonCodeSpans[spanIndex].end <= start) {
      spanIndex += 1;
    }
    const span = nonCodeSpans[spanIndex];
    if (span && start >= span.start && start < span.end) continue;

    const replacement = replacementFor(match[0]);
    if (replacement !== match[0]) {
      edits.push({ start, end: start + match[0].length, text: replacement });
    }
  }
  return edits;
}

/** Clean pasted SQL only when the user runs the editor action. */
export function cleanSqlInvisibleCharacters(
  text: string,
  dialect?: Dialect | string,
): string {
  const edits = getSqlInvisibleCharacterEdits(text, dialect);
  if (edits.length === 0) return text;

  let result = '';
  let offset = 0;
  for (const edit of edits) {
    result += text.slice(offset, edit.start) + edit.text;
    offset = edit.end;
  }
  return result + text.slice(offset);
}
