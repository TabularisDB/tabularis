---
title: "SQL Editor"
order: 4
excerpt: "How to use the modern SQL editor in Tabularis with syntax highlighting, autocomplete, and multi-tab support."
category: "Core Features"
---

# SQL Editor

The **SQL Editor** in Tabularis is built around a highly customized integration of **Monaco** (the exact editor engine that powers VS Code). It provides a world-class typing experience optimized specifically for complex database querying.

![SQL Editor](/img/tabularis-sql-editor-data-grid.png)

## Intelligent Context-Aware Autocomplete

Unlike basic editors that simply suggest a static list of SQL keywords and table names, Tabularis implements a dynamic, context-aware autocomplete engine.

### How It Works
1. **AST Parsing**: As you type, a lightweight local parser analyzes your SQL statement to build an Abstract Syntax Tree (AST).
2. **Scope Resolution**: The engine identifies which tables are present in the `FROM` and `JOIN` clauses.
3. **Alias Mapping**: It maps aliases to their source tables (e.g., `FROM customer_orders AS co`).
4. **Targeted Suggestions**: When you type `co.`, the editor immediately suggests only the columns belonging to the `customer_orders` table, along with their data types.

### Caching Strategy
To ensure the editor remains responsive even on databases with thousands of tables, Tabularis caches schema metadata:
- **TTL**: Table metadata is cached in memory for 5 minutes.
- **Size limit**: The cache holds metadata for at most 50 tables. When the limit is exceeded, expired entries are evicted first; if still over the limit, the oldest entries are removed.
- **Manual Invalidation**: You can force a cache clear by clicking the "Refresh Schema" button in the sidebar or via the Command Palette.

## Editor Features & Shortcuts

The Monaco integration brings powerful developer features:

| Feature | Shortcut (Mac) | Shortcut (Win/Linux) | Description |
| :--- | :--- | :--- | :--- |
| **Execute** | `Cmd + Enter` or `Cmd + F5` | `Ctrl + Enter` or `Ctrl + F5` | Runs the selected text, or the entire script if nothing is selected. |
| **Execute Selection** | *(context menu only)* | *(context menu only)* | Right-click → "Execute Selection" to run highlighted text. |
| **Format SQL** | `Shift + Option + F` | `Shift + Alt + F` | Prettifies the SQL syntax (built-in Monaco). |
| **Toggle Comment** | `Cmd + /` | `Ctrl + /` | Comments/uncomments the current line or selection (built-in Monaco). |
| **Multi-Cursor** | `Option + Click` | `Alt + Click` | Place multiple cursors for simultaneous editing (built-in Monaco). |
| **Command Palette**| `F1` | `F1` | Open the Monaco command palette. |

## Multi-Statement Execution

When the editor contains multiple semicolon-separated queries and you press Execute, Tabularis opens a **Query Selection Modal** with three execution modes:

### Run a Single Query

Click any query in the list (or press its number `1`–`9`) to execute just that one.

### Run All

Click **Run All** (or press `Ctrl/Cmd + Enter` inside the modal) to execute every query in the editor. Results from each query appear in separate tabs in the results panel.

### Run Selected

Use the checkboxes to pick specific queries, then click **Run Selected (N)** (or press `Shift + Enter`). Only the checked queries are executed. Use **Select All / Deselect All** to toggle the entire list, or press `Space` to toggle the focused query.

### Keyboard Navigation

| Shortcut | Action |
|----------|--------|
| `↑` / `↓` | Move focus between queries |
| `Enter` | Execute the focused query |
| `1`–`9` | Directly execute query N |
| `Space` | Toggle checkbox on focused query |
| `Ctrl/Cmd + Enter` | Run All |
| `Shift + Enter` | Run Selected |

### Execute Selection

If you highlight a text selection in the editor and run it, Tabularis splits the selection by `;` and executes all contained queries concurrently. Results appear as separate tabs in the multi-result panel.

## Multi-Result Panel

When multiple queries are executed (via Run All, Run Selected, or Execute Selection), results are displayed in a **results panel** at the bottom of the editor. Each query gets its own result with independent pagination, error handling, and loading state.

The panel supports two view modes — **Tab view** (default) and **Stacked view** — switchable via the toggle button in the top-right corner of the results bar.

### Tab View

The default view. Each query result lives in its own tab. Click a tab to switch between results.

| Action | How |
|--------|-----|
| Switch tab | Click the tab header |
| Close tab | Click the **X** button or middle-click |
| Rename tab | Double-click the tab header or right-click → Rename |
| AI rename | Click the sparkles icon (requires AI enabled in Settings) |
| Context menu | Right-click a tab for Close / Close Others / Close Right / Close Left / Close All |
| Re-run | Click the play icon on a tab to re-execute that query |

A summary bar shows the total number of queries and how many succeeded or failed. Each tab displays a collapsible query preview, row count, and execution time.

### Stacked View

Inspired by SQL Server Management Studio, the stacked view displays **all query results vertically** in a single scrollable panel — no tab switching required.

| Action | How |
|--------|-----|
| Collapse / Expand | Click a result header to toggle its content |
| Collapse All / Expand All | Click the collapse button in the top bar |
| Close result | Click the **X** button or middle-click on the header |
| Rename | Double-click the result label |
| AI rename | Click the sparkles icon on the header |
| Re-run | Click the play icon on the header |
| Resize | Drag the resize handle between results to adjust height |

Each result section shows the query label, a collapsible SQL preview, row count, execution time, and pagination controls — all inline in the header. When collapsed, the header still shows key metadata (row count, execution time, error summary).

### Query Parameters

When running multiple queries that contain `:param` placeholders, Tabularis collects parameters across all queries and prompts you **once** via the parameters modal before execution begins.

## Query Splitting

Tabularis uses [dbgate-query-splitter](https://github.com/nicedoc/dbgate-query-splitter) to split multi-statement SQL. This handles complex syntax like stored procedures and functions that contain internal semicolons:

```sql
CREATE FUNCTION example()
RETURNS INT
LANGUAGE PLPGSQL
AS $$
BEGIN
    RETURN 10::INT;
END;
$$;
```

The splitter correctly treats this as a single statement rather than breaking on the internal `;` inside the `$$` block.

## Autocomplete: Multi-Database and Multi-Schema

Autocomplete suggestions are scoped to the active context:

- **Schema-aware connections** (PostgreSQL): when a non-default schema is active, suggestions come from the tables in that schema only.
- **Multi-database connections** (MySQL / MariaDB): suggestions come from the tables of all selected databases.

This ensures that you see relevant completions regardless of how many schemas or databases your connection exposes.

## Query Execution & Data Grid

When you execute a query, Tabularis handles the results asynchronously, streaming them into the integrated Data Grid.

## Query History Sidebar

Every execution is also written to the Explorer's **History** tab for the active connection.

![Query History tab in the Explorer sidebar](/img/tabularis-query-history-sidebar.png)

### What gets stored

Each history entry includes:

- The SQL text
- Execution timestamp
- Execution duration
- Success or error status
- Rows affected when available

History is stored per connection, newest first. If you run the exact same SQL twice in a row, Tabularis updates the latest entry instead of appending a duplicate immediately after it.

### Working from history

The History tab supports:

- **Search** by SQL text
- **Date grouping** such as Today / Yesterday / older buckets
- **Double-click to reopen** a query in the editor without auto-running it
- **Context menu actions** to copy SQL, run it, run it in a new tab, save it to Favorites, or delete the entry
- **Clear All** for the current connection only

This makes the sidebar history a fast iteration loop: run a query, tweak it, and jump back to any earlier version without digging through editor tabs.

### History retention

The maximum number of stored entries is controlled in **Settings → General → Query History**. The backing config key is `queryHistoryMaxEntries`, with a default of `500`.

### Transaction Management
By default, queries are executed in auto-commit mode. However, you can manually wrap your statements in `BEGIN; ... COMMIT;` blocks. If an error occurs midway through a block, Tabularis halts execution and outputs the precise line and database engine error.

### Powerful Data Grid
The results grid is heavily optimized to handle thousands of rows without dropping frames:
- **Inline Editing**: Double-click any cell to modify its content. Changes are marked in yellow and can be committed back to the database with a single click (generating `UPDATE` statements securely via primary keys).
- **Rich Data Types**: JSON columns include a built-in JSON viewer/formatter. Spatial data displays coordinates.
- **Exporting**: Export the current view to CSV or JSON instantly.
- **Copy with Headers**: Highlight cells, right-click, and select "Copy with Headers" to easily paste data into Excel or Google Sheets.
