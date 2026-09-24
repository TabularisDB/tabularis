import type { NotebookCell } from "../types/notebook";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdownCell(content: string): string {
  // Basic markdown to HTML: headings, bold, italic, code, lists
  let html = escapeHtml(content);

  // Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.+<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

  // Line breaks for remaining text
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;
  html = html.replace(/<p><(h[1-3]|ul|hr|blockquote)/g, "<$1");
  html = html.replace(/<\/(h[1-3]|ul|hr|blockquote)><\/p>/g, "</$1>");

  return `<div class="markdown-cell">${html}</div>`;
}

function renderSqlCell(cell: NotebookCell, index: number): string {
  let html = `<div class="sql-cell">`;
  const schemaLabel = cell.schema ? ` · <span style="color:#79c0ff">${escapeHtml(cell.schema)}</span>` : "";
  html += `<div class="cell-header">SQL Cell #${index + 1}${schemaLabel}</div>`;
  html += `<pre class="sql-code"><code>${escapeHtml(cell.content)}</code></pre>`;

  if (cell.error) {
    html += `<div class="cell-error">${escapeHtml(cell.error)}</div>`;
  }

  if (cell.result && cell.result.rows.length > 0) {
    html += `<div class="cell-meta">${cell.result.rows.length} rows`;
    if (cell.executionTime != null) {
      html += ` · ${Math.round(cell.executionTime)}ms`;
    }
    html += `</div>`;
    html += `<table class="result-table">`;
    html += `<thead><tr>${cell.result.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
    html += `<tbody>`;
    for (const row of cell.result.rows) {
      html += `<tr>${row.map((v) => `<td>${v === null ? "<em>NULL</em>" : escapeHtml(String(v))}</td>`).join("")}</tr>`;
    }
    html += `</tbody></table>`;
  }

  html += `</div>`;
  return html;
}

const CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; background: #0d1117; color: #c9d1d9; }
  h1 { color: #f0f6fc; border-bottom: 1px solid #21262d; padding-bottom: .5rem; }
  h2 { color: #f0f6fc; margin-top: 2rem; }
  h3 { color: #e6edf3; }
  .markdown-cell { margin: 1rem 0; padding: 1rem; background: #161b22; border-radius: 8px; border: 1px solid #21262d; }
  .markdown-cell p { margin: .5rem 0; line-height: 1.6; }
  .markdown-cell code { background: #1f2937; padding: 2px 6px; border-radius: 4px; font-size: .85em; }
  .markdown-cell blockquote { border-left: 3px solid #3b82f6; padding-left: .75rem; color: #8b949e; font-style: italic; }
  .sql-cell { margin: 1rem 0; border: 1px solid #21262d; border-radius: 8px; overflow: hidden; }
  .cell-header { background: #161b22; padding: .5rem 1rem; font-size: .75rem; color: #8b949e; font-weight: 600; text-transform: uppercase; border-bottom: 1px solid #21262d; }
  .sql-code { background: #0d1117; padding: 1rem; margin: 0; font-size: .85rem; overflow-x: auto; color: #79c0ff; }
  .cell-meta { padding: .4rem 1rem; font-size: .75rem; color: #8b949e; background: #161b22; border-top: 1px solid #21262d; }
  .cell-error { padding: .75rem 1rem; background: #3d1114; color: #f85149; font-size: .85rem; border-top: 1px solid #48211d; }
  .result-table { width: 100%; border-collapse: collapse; font-size: .8rem; }
  .result-table th { background: #161b22; padding: .4rem .75rem; text-align: left; border: 1px solid #21262d; color: #8b949e; font-weight: 600; }
  .result-table td { padding: .4rem .75rem; border: 1px solid #21262d; }
  .result-table em { color: #8b949e; }
  .result-table tr:nth-child(even) { background: #161b2210; }
  ul { padding-left: 1.5rem; }
  li { margin: .25rem 0; }
  hr { border: none; border-top: 1px solid #21262d; margin: 1.5rem 0; }
  strong { color: #f0f6fc; }
`;

export function exportNotebookToHtml(
  title: string,
  cells: NotebookCell[],
): string {
  let body = "";
  cells.forEach((cell, index) => {
    if (cell.type === "markdown") {
      body += renderMarkdownCell(cell.content);
    } else {
      body += renderSqlCell(cell, index);
    }
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${CSS}</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
  <footer style="margin-top:3rem;padding-top:1rem;border-top:1px solid #21262d;font-size:.75rem;color:#484f58;">
    Exported from Tabularis Notebook
  </footer>
</body>
</html>`;
}
