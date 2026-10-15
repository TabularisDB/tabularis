import { useState, useEffect } from "react";
import { ensureMonaco } from "./monaco";
import type * as Monaco from "monaco-editor";

let monacoInstance: typeof Monaco | null = null;

/**
 * Uses Monaco's own colorize API to produce syntax-highlighted HTML
 * that exactly matches the editor theme.
 */
export function useColorizedSql(sql: string): string | null {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    ensureMonaco().then((monaco) => {
      monacoInstance = monaco;
      if (cancelled) return;
      return monaco.editor.colorize(sql, "sql", { tabSize: 2 }).then((result: string) => {
        if (!cancelled) setHtml(result);
      });
    }).catch((error: unknown) => console.error("Failed to highlight SQL:", error));

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
