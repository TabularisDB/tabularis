/**
 * Presentation helpers for the raw EXPLAIN payload shown in Visual EXPLAIN.
 *
 * Built-in drivers hand over JSON or plain text; plugin parsers can return
 * other serialisations, such as SQL Server SHOWPLAN XML, which the server
 * emits on a single line. These helpers pick the editor language and make
 * a one-line XML document readable without touching the parsed plan.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

export type RawExplainLanguage = "json" | "xml" | "plaintext";

/** Pick the Monaco language for a raw EXPLAIN payload from its first character. */
export function detectRawExplainLanguage(raw: string): RawExplainLanguage {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<")) return "xml";
  return "plaintext";
}

/**
 * Return the file extension matching the detected raw EXPLAIN payload language.
 * "json" maps to "json", "xml" to "xml", and "plaintext" to "txt".
 */
export function getRawExplainExtension(language: RawExplainLanguage): string {
  switch (language) {
    case "json":
      return "json";
    case "xml":
      return "xml";
    case "plaintext":
    default:
      return "txt";
  }
}

/**
 * Return a clean user-facing format label for a raw EXPLAIN payload.
 * "json" maps to "JSON", "xml" to "XML", and "plaintext" to the provided text label (defaults to "Text").
 */
export function getRawExplainFormatLabel(
  language: RawExplainLanguage,
  formatTextLabel = "Text",
): string {
  switch (language) {
    case "json":
      return "JSON";
    case "xml":
      return "XML";
    case "plaintext":
    default:
      return formatTextLabel;
  }
}

export interface RawExplainFileFilter {
  name: string;
  extensions: string[];
}

export interface RawExplainFileDialogOptions {
  defaultPath: string;
  filters: RawExplainFileFilter[];
}

/**
 * Build default file name and filter options for the file save dialog based on raw payload.
 */
export function getRawExplainFileOptions(raw: string): RawExplainFileDialogOptions {
  const language = detectRawExplainLanguage(raw);
  const ext = getRawExplainExtension(language);
  const filterName =
    language === "json" ? "JSON" : language === "xml" ? "XML" : "Text";

  return {
    defaultPath: `explain.${ext}`,
    filters: [
      { name: filterName, extensions: [ext] },
      { name: "All files", extensions: ["*"] },
    ],
  };
}

export interface SaveRawExplainDependencies {
  saveDialog?: (options: RawExplainFileDialogOptions) => Promise<string | null>;
  writeFile?: (path: string, content: string) => Promise<void>;
}

/**
 * Prompt the user for a destination file and write the raw EXPLAIN output.
 * Returns true when successfully saved, or false when the user cancelled the dialog.
 * Throws when dialog prompt or file writing fails.
 */
export async function saveRawExplainOutput(
  raw: string,
  deps: SaveRawExplainDependencies = {},
): Promise<boolean> {
  const saveDialog = deps.saveDialog ?? save;
  const writeFile = deps.writeFile ?? writeTextFile;

  const options = getRawExplainFileOptions(raw);
  const path = await saveDialog(options);
  if (!path) {
    return false;
  }

  await writeFile(path, raw);
  return true;
}

/**
 * Return the payload as it should be displayed: XML that arrives on a single
 * line is indented, everything else is returned unchanged.
 */
export function formatRawExplainOutput(raw: string): string {
  if (detectRawExplainLanguage(raw) !== "xml") return raw;
  const trimmed = raw.trim();
  // Already spread over several lines: assume the producer formatted it.
  if (trimmed.includes("\n")) return raw;
  return formatXml(trimmed);
}

const INDENT = "  ";

/**
 * Tokens are markup (`<...>`, comments, CDATA, processing instructions) or the
 * text between them. Quoted attribute values may contain `>`, so the tag
 * alternative consumes quoted strings as units.
 */
const XML_TOKEN =
  /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g;

function isClosingTag(token: string): boolean {
  return token.startsWith("</");
}

function isOpeningTag(token: string): boolean {
  return (
    token.startsWith("<") &&
    !token.startsWith("</") &&
    !token.startsWith("<!") &&
    !token.startsWith("<?") &&
    !token.endsWith("/>")
  );
}

/** Indent a single-line XML document one node per line. */
export function formatXml(xml: string): string {
  const tokens = (xml.match(XML_TOKEN) ?? [])
    .map((token) => (token.startsWith("<") ? token : token.trim()))
    .filter((token) => token.length > 0);

  const lines: string[] = [];
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (isClosingTag(token)) {
      depth = Math.max(0, depth - 1);
      lines.push(INDENT.repeat(depth) + token);
      continue;
    }

    if (isOpeningTag(token)) {
      const text = tokens[i + 1];
      const close = tokens[i + 2];
      // Keep `<Tag>text</Tag>` on one line so leaf values stay readable.
      if (
        text !== undefined &&
        !text.startsWith("<") &&
        close !== undefined &&
        isClosingTag(close)
      ) {
        lines.push(INDENT.repeat(depth) + token + text + close);
        i += 2;
        continue;
      }
      lines.push(INDENT.repeat(depth) + token);
      depth += 1;
      continue;
    }

    // Self-closing tags, declarations, comments, CDATA and stray text.
    lines.push(INDENT.repeat(depth) + token);
  }

  return lines.join("\n");
}
