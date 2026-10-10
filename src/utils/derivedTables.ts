/**
 * Lightweight SQL structural scanner for column autocomplete.
 * It intentionally does not try to validate SQL: incomplete statements are
 * normal while the editor is invoking completions.
 */
export interface DerivedColumn {
  name: string;
  sourceExpression?: string;
}

export interface DerivedTable {
  name: string;
  columns: DerivedColumn[];
  bodyStart: number;
  bodyEnd: number;
  kind: "CTE" | "Derived table";
}

type Kind = "word" | "identifier" | "literal" | "symbol";
interface Token {
  text: string;
  start: number;
  end: number;
  depth: number;
  kind: Kind;
}

const wordStart = (c: string): boolean => /[a-zA-Z_]/.test(c);
const wordPart = (c: string): boolean => /[\w$]/.test(c);

function lex(sql: string): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  for (let i = 0; i < sql.length;) {
    const start = i;
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i = Math.min(sql.length, i + 2);
      continue;
    }
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const endQuote = c === "[" ? "]" : c;
      i++;
      let name = "";
      while (i < sql.length) {
        if (sql[i] === endQuote) {
          if (sql[i + 1] === endQuote) {
            name += endQuote;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (c === "'" && sql[i] === "\\" && i + 1 < sql.length) {
          name += sql[i + 1];
          i += 2;
        } else {
          name += sql[i++];
        }
      }
      tokens.push({ text: name, start, end: i, depth,
        kind: c === "'" ? "literal" : "identifier" });
      continue;
    }
    if (wordStart(c)) {
      i++;
      while (i < sql.length && wordPart(sql[i])) i++;
      tokens.push({ text: sql.slice(start, i).toLowerCase(), start, end: i,
        depth, kind: "word" });
      continue;
    }
    i++;
    if (c === ")") depth = Math.max(0, depth - 1);
    tokens.push({ text: c, start, end: i, depth, kind: "symbol" });
    if (c === "(") depth++;
  }
  return tokens;
}

const is = (token: Token | undefined, word: string): boolean =>
  token?.kind === "word" && token.text === word;

const identifier = (token: Token | undefined): string | undefined =>
  token && (token.kind === "word" || token.kind === "identifier")
    ? token.text : undefined;

function pairs(tokens: Token[]): Map<number, number> {
  const result = new Map<number, number>();
  const stack: number[] = [];
  tokens.forEach((token, i) => {
    if (token.text === "(" && token.kind === "symbol") stack.push(i);
    if (token.text === ")" && token.kind === "symbol") {
      const opening = stack.pop();
      if (opening !== undefined) result.set(opening, i);
    }
  });
  return result;
}

function explicitColumns(tokens: Token[], start: number, end: number): DerivedColumn[] {
  const out: DerivedColumn[] = [];
  for (let i = start; i < end; i++) {
    const name = identifier(tokens[i]);
    if (name) out.push({ name });
  }
  return out;
}

const clauseWords = new Set([
  "from", "where", "group", "order", "having", "limit", "offset",
  "union", "intersect", "except", "window", "qualify", "returning",
]);

function selectColumns(sql: string): DerivedColumn[] {
  const tokens = lex(sql);
  const select = tokens.findIndex(t => is(t, "select") && t.depth === 0);
  if (select < 0) return [];
  let first = select + 1;
  if (is(tokens[first], "distinct") || is(tokens[first], "all")) first++;
  const end = tokens.findIndex((t, i) =>
    i >= first && t.depth === 0 && t.kind === "word" && clauseWords.has(t.text));
  const last = end >= 0 ? end : tokens.length;
  const segments: Token[][] = [];
  let segment: Token[] = [];
  for (let i = first; i < last; i++) {
    const t = tokens[i];
    if (t.text === "," && t.depth === 0) {
      segments.push(segment);
      segment = [];
    } else {
      segment.push(t);
    }
  }
  segments.push(segment);
  const columns: DerivedColumn[] = [];
  for (const group of segments) {
    if (!group.length) continue;
    let at = -1;
    for (let i = 0; i < group.length - 1; i++) {
      if (group[i].depth === 0 && is(group[i], "as") &&
        identifier(group[i + 1]) !== undefined) at = i;
    }
    let name: string | undefined;
    if (at >= 0) {
      name = identifier(group[at + 1]);
    } else if (group.length === 1) {
      name = identifier(group[0]);
    } else {
      const end = group[group.length - 1];
      const prev = group[group.length - 2];
      // table.column, including quoted names
      if (prev.text === ".") name = identifier(end);
      // expression followed by a plain alias
      else if (identifier(end) && end.depth === 0 &&
          !["end", "null", "true", "false"].includes(end.text) &&
          !["+", "-", "*", "/", "%", "|", "&", "=", ":", ">", "<"].includes(prev.text) &&
          !(group.length === 2 && group[0].text === "*")) {
        name = identifier(end);
      }
    }
    if (name && name !== "*") {
      columns.push({ name, sourceExpression: sql.slice(
        group[0].start, group[group.length - 1].end,
      ) });
    }
  }
  return columns;
}

/** Parse only the CTEs/derived tables visible at the cursor's lexical scope. */
export function parseDerivedTables(sql: string, cursor = sql.length): DerivedTable[] {
  const tokens = lex(sql);
  const matched = pairs(tokens);
  const visible = new Map<string, DerivedTable>();

  // The closest parenthesis around a token bounds its SQL scope.
  const parentStack: number[] = [];
  const scopeEnd: number[] = [];
  const scopeStart: number[] = [];
  tokens.forEach((t, i) => {
    while (parentStack.length &&
      (matched.get(parentStack[parentStack.length - 1]) ?? Infinity) < i) {
      parentStack.pop();
    }
    scopeEnd[i] = parentStack.length
      ? tokens[matched.get(parentStack[parentStack.length - 1])!].start
      : sql.length;
    scopeStart[i] = parentStack.length
      ? tokens[parentStack[parentStack.length - 1]].end
      : 0;
    if (t.text === "(" && matched.has(i)) parentStack.push(i);
  });

  // An outer query/CTE must not see definitions in a later statement.
  const statements = tokens.filter(t => t.text === ";" && t.depth === 0)
    .map(t => t.start);
  const statementStart = [...statements].reverse().find(s => s < cursor) ?? -1;
  const statementEnd = statements.find(s => s >= cursor) ?? sql.length;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.start <= statementStart || token.start >= statementEnd) continue;

    if (is(token, "with")) {
      let j = i + 1;
      if (is(tokens[j], "recursive")) j++;
      for (;;) {
        const name = identifier(tokens[j]);
        if (!name) break;
        const key = name.toLowerCase();
        j++;
        let cols: DerivedColumn[] | undefined;
        if (tokens[j]?.text === "(" && matched.has(j)) {
          const close = matched.get(j)!;
          cols = explicitColumns(tokens, j + 1, close);
          j = close + 1;
        }
        if (!is(tokens[j], "as")) break;
        j++;
        if (is(tokens[j], "not")) j++;
        if (is(tokens[j], "materialized")) j++;
        const open = j;
        const close = matched.get(open);
        if (tokens[open]?.text !== "(" || close === undefined) break;
        const bodyStart = tokens[open].end;
        const bodyEnd = tokens[close].start;
        const end = Math.min(scopeEnd[i], statementEnd);
        if (cursor >= tokens[close].end && cursor <= end) {
          visible.set(key, {
            name, columns: cols ?? selectColumns(sql.slice(bodyStart, bodyEnd)),
            bodyStart, bodyEnd, kind: "CTE",
          });
        }
        j = close + 1;
        if (tokens[j]?.text !== ",") break;
        j++;
      }
    }

    if (!is(token, "from") && !is(token, "join")) continue;
    const open = i + 1;
    const close = matched.get(open);
    if (tokens[open]?.text !== "(" || close === undefined) continue;
    const bodyStart = tokens[open].end;
    const bodyEnd = tokens[close].start;
    const firstBody = tokens[open + 1];
    if (!is(firstBody, "select") && !is(firstBody, "with")) continue;
    let aliasAt = close + 1;
    if (is(tokens[aliasAt], "as")) aliasAt++;
    const alias = identifier(tokens[aliasAt]);
    if (!alias) continue;
    let cols: DerivedColumn[] | undefined;
    if (tokens[aliasAt + 1]?.text === "(" &&
      matched.has(aliasAt + 1)) {
      const end = matched.get(aliasAt + 1)!;
      cols = explicitColumns(tokens, aliasAt + 2, end);
    }
    // A SELECT list may appear *before* its FROM alias, as in
    // SELECT x.| FROM (SELECT ...) x. Use the containing query scope,
    // not the alias's textual position, to decide visibility.
    if (cursor >= Math.max(scopeStart[i], statementStart + 1) &&
        cursor <= Math.min(scopeEnd[i], statementEnd) &&
        !(cursor >= bodyStart && cursor < bodyEnd)) {
      visible.set(alias.toLowerCase(), {
        name: alias, columns: cols ?? selectColumns(sql.slice(bodyStart, bodyEnd)),
        bodyStart, bodyEnd, kind: "Derived table",
      });
    }
  }
  return [...visible.values()];
}

/** Hide nested SELECT/CTE text from regex-based physical-table parsing. */
export function maskNestedSqlBodies(sql: string): string {
  const tokens = lex(sql);
  const matched = pairs(tokens);
  const masked = sql.split("");
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text !== "(" || !matched.has(i)) continue;
    const next = tokens[i + 1];
    if (!is(next, "select") && !is(next, "with")) continue;
    const close = tokens[matched.get(i)!];
    for (let p = tokens[i].end; p < close.start; p++) {
      if (masked[p] !== "\n") masked[p] = " ";
    }
  }
  return masked.join("");
}
