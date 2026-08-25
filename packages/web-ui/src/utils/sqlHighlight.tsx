import { useState, useEffect } from "react";
import { loader } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

let monacoInstance: typeof Monaco | null = null;

// Initialize Monaco instance once
const monacoReady = loader.init().then((monaco: typeof Monaco) => {
  monacoInstance = monaco;
  return monaco;
});

/**
 * Uses Monaco's own colorize API to produce syntax-highlighted HTML
 * that exactly matches the editor theme.
 */
export function useColorizedSql(sql: string): string | null {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    monacoReady.then((monaco: typeof Monaco) => {
      if (cancelled) return;
      monaco.editor.colorize(sql, "sql", { tabSize: 2 }).then((result: string) => {
        if (!cancelled) setHtml(result);
      });
    });

    return () => { cancelled = true; };
  }, [sql]);

  return html;
}

/**
 * Synchronous colorize — returns HTML if Monaco is already loaded, null otherwise.
 * Prefer useColorizedSql hook in components.
 */
export function colorizeSqlSync(sql: string): Promise<string> | null {
  if (!monacoInstance) return null;
  return monacoInstance.editor.colorize(sql, "sql", { tabSize: 2 });
}

export function formatSqlPreview(sql: string, maxLines = 3): string {
  const lines = sql.split("\n").map((l) => l.trim()).filter(Boolean);
  const preview = lines.slice(0, maxLines).join("\n");
  if (lines.length > maxLines) return preview + " ...";
  return preview;
}
