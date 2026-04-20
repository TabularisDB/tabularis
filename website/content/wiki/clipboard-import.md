---
title: "Clipboard Import"
order: 6.6
excerpt: "Paste CSV, TSV, JSON, or Markdown table data directly into any database table — with automatic type inference and a schema editor."
category: "Database Objects"
---

# Clipboard Import

**Clipboard Import** lets you take structured data sitting in your clipboard — a copied spreadsheet range, a CSV paste, a JSON array, or a Markdown table — and insert it into a database table without writing a single SQL statement.

Right-click a database or schema in the sidebar and choose **Import from Clipboard**, or use the context menu on an existing table. The import modal opens and immediately reads your clipboard.

## Supported Formats

Tabularis detects the format automatically:

| Format | Example source |
| :--- | :--- |
| **TSV** (tab-separated) | Copied rows from Excel, Google Sheets, LibreOffice Calc |
| **CSV** (comma or semicolon-separated) | Exported CSV files pasted directly |
| **JSON Array** | `[{"col": "val"}, ...]` or a JSON object array |
| **Markdown table** | Table blocks copied from docs, GitHub, Notion |

If the first row looks like headers, Tabularis marks it as a header row. You can toggle this with the **First row as header** checkbox in the parse summary bar.

## Schema Inference

After parsing, Tabularis infers a column type for each field:

| Inferred type | When used |
| :--- | :--- |
| `INTEGER` | Whole numbers |
| `REAL` | Decimal numbers |
| `BOOLEAN` | `true`/`false`, `1`/`0`, `yes`/`no` values |
| `DATE` | ISO date strings |
| `DATETIME` | ISO datetime strings |
| `TEXT` | Everything else |
| `JSON` | Nested JSON objects or arrays within a cell |

Inferred types are then mapped to the actual SQL types of your active driver (e.g., `INTEGER` becomes `INT` for MySQL, `INTEGER` for SQLite). Columns with mixed types fall back to `TEXT` and are flagged with a low-confidence indicator.

You can edit any column name or type directly in the **Column Schema** panel before importing.

## Import Modes

### Create New Table

A new table is created with the inferred schema and the rows are inserted. You must provide a table name. If a table with that name already exists, the **If exists** strategy applies:

| Strategy | Behaviour |
| :--- | :--- |
| **Fail with error** | The import is cancelled if the table already exists |
| **Append rows** | Rows are inserted into the existing table without touching its schema |
| **Replace table** | The existing table is dropped and recreated with the new schema |

Use **AI Suggest** to let the configured AI provider propose a descriptive table name and column names based on your data.

### Append to Existing

Select a target table from the dropdown. The **Column Schema** panel switches to a mapping view: each clipboard column can be mapped to an existing column in the target table, set to create a new column via `ALTER TABLE ADD COLUMN`, or skipped entirely.

Tabularis auto-maps clipboard columns to target columns by name. Unmatched columns default to **Skip**.

## The Schema Editor

The schema editor is the main review step. Each row is a clipboard column with:

- **Name** — editable text field
- **Type** — dropdown with all types supported by the active driver
- **Nullable** — checkbox
- **Low-confidence indicator** — shown when Tabularis had to fall back to TEXT due to mixed values in a column
- **Sample values** — a comma-separated preview of the first values in that column

You can select multiple columns and delete them in bulk using the **Delete selected** action.

Use the **maximize** button to expand either the schema editor or the data preview to full height for easier review on large datasets.

## Data Preview

The **Data Preview** panel shows the first rows as a table. It updates as you adjust the header-row toggle. It is read-only — it reflects the parsed input, not the final SQL output.

## How to Access

- **Right-click a database or schema** in the sidebar → **Import from Clipboard**
- **Right-click a table** in the sidebar → **Import from Clipboard** (pre-selects that table in append mode)

The clipboard is read automatically when the modal opens. If the clipboard is empty or the content cannot be parsed, an error message is shown with a **Try again** button to re-read after you copy something.
