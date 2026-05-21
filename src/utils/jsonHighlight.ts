/**
 * Lightweight tokenizer for syntax-highlighting JSON in DataGrid cells.
 *
 * Operates on display strings that may be truncated or malformed — the goal
 * is "good-enough" coloring, not strict validation. Never throws.
 */

export type JsonTokenType =
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punct"
  | "whitespace";

export interface JsonToken {
  type: JsonTokenType;
  text: string;
}

const WHITESPACE = /\s/;
const NUMBER_CHAR = /[-+0-9eE.]/;

export function tokenizeJsonDisplay(input: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const n = input.length;
  let i = 0;

  while (i < n) {
    const c = input[i];

    if (WHITESPACE.test(c)) {
      let j = i + 1;
      while (j < n && WHITESPACE.test(input[j])) j++;
      tokens.push({ type: "whitespace", text: input.slice(i, j) });
      i = j;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      while (j < n && input[j] !== '"') {
        if (input[j] === "\\" && j + 1 < n) j += 2;
        else j++;
      }
      const end = Math.min(j + 1, n);
      const text = input.slice(i, end);

      let k = end;
      while (k < n && WHITESPACE.test(input[k])) k++;
      const isKey = k < n && input[k] === ":";

      tokens.push({ type: isKey ? "key" : "string", text });
      i = end;
      continue;
    }

    if (c === "t" && input.startsWith("true", i)) {
      tokens.push({ type: "boolean", text: "true" });
      i += 4;
      continue;
    }
    if (c === "f" && input.startsWith("false", i)) {
      tokens.push({ type: "boolean", text: "false" });
      i += 5;
      continue;
    }
    if (c === "n" && input.startsWith("null", i)) {
      tokens.push({ type: "null", text: "null" });
      i += 4;
      continue;
    }

    if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < n && NUMBER_CHAR.test(input[j])) j++;
      tokens.push({ type: "number", text: input.slice(i, j) });
      i = j;
      continue;
    }

    tokens.push({ type: "punct", text: c });
    i++;
  }

  return tokens;
}
