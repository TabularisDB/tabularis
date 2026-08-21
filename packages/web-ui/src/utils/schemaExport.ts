import type { Node, Edge } from "@xyflow/react";

export interface SchemaColumn {
  name: string;
  type?: string;
  isPk?: boolean;
  isFk?: boolean;
}

interface SchemaNodeData {
  label?: string;
  columns?: SchemaColumn[];
}

/**
 * Mermaid identifiers must not contain spaces or special characters. Anything
 * outside [A-Za-z0-9_] is replaced so the generated diagram stays parseable
 * with table names like "order details" or "public.users".
 */
export const sanitizeMermaidId = (name: string): string => {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `t_${cleaned}` : cleaned;
};

/**
 * Mermaid attribute types share the same constraint, and an empty type would
 * produce an invalid line, so fall back to a placeholder.
 */
const sanitizeMermaidType = (type?: string): string => {
  if (!type) return "unknown";
  const cleaned = type.replace(/[^A-Za-z0-9_]/g, "_");
  return cleaned.length > 0 ? cleaned : "unknown";
};

/**
 * Builds a Mermaid `erDiagram` from the nodes and edges backing the ER view.
 *
 * Rendered natively by GitHub, GitLab and most documentation tools, so the
 * output can be pasted straight into a README.
 */
export const generateMermaidErDiagram = (
  nodes: Node[],
  edges: Edge[],
): string => {
  const lines: string[] = ["erDiagram"];

  for (const node of nodes) {
    const data = (node.data ?? {}) as SchemaNodeData;
    const tableId = sanitizeMermaidId(String(data.label ?? node.id));
    const columns = data.columns ?? [];

    if (columns.length === 0) {
      lines.push(`    ${tableId} {`, `    }`);
      continue;
    }

    lines.push(`    ${tableId} {`);
    for (const column of columns) {
      const type = sanitizeMermaidType(column.type);
      const name = sanitizeMermaidId(column.name);
      const keys = [column.isPk ? "PK" : null, column.isFk ? "FK" : null]
        .filter(Boolean)
        .join(",");
      lines.push(`        ${type} ${name}${keys ? ` ${keys}` : ""}`);
    }
    lines.push(`    }`);
  }

  // The ER view draws one edge per foreign key column, so a composite FK would
  // otherwise produce duplicate relationship lines between the same two tables.
  const seen = new Set<string>();

  for (const edge of edges) {
    const source = sanitizeMermaidId(edge.source);
    const target = sanitizeMermaidId(edge.target);
    const label = edge.sourceHandle
      ? sanitizeMermaidId(String(edge.sourceHandle))
      : "references";
    const key = `${source}|${target}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // The child table holds the foreign key, so it is the "many" side.
    lines.push(`    ${target} ||--o{ ${source} : "${label}"`);
  }

  return lines.join("\n") + "\n";
};

/**
 * DBML identifiers only need quoting when they are not plain words, so keep the
 * output readable and quote only when necessary.
 */
const quoteDbmlIdent = (name: string): string =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name}"`;

/**
 * Builds a DBML schema (https://dbml.dbdiagram.io) from the ER diagram data.
 *
 * Unlike Mermaid, DBML expresses relationships at column level, so a foreign
 * key keeps both endpoints instead of collapsing to a table-to-table edge. The
 * output round-trips through dbdiagram.io and dbml-to-sql.
 */
export const generateDbml = (nodes: Node[], edges: Edge[]): string => {
  const blocks: string[] = [];

  for (const node of nodes) {
    const data = (node.data ?? {}) as SchemaNodeData;
    const tableName = String(data.label ?? node.id);
    const columns = data.columns ?? [];
    const pkColumns = columns.filter((c) => c.isPk).map((c) => c.name);
    // A composite primary key cannot be expressed with per-column [pk]; DBML
    // requires an Indexes block listing the columns together.
    const isComposite = pkColumns.length > 1;

    const lines: string[] = [`Table ${quoteDbmlIdent(tableName)} {`];

    for (const column of columns) {
      const type = column.type ?? "unknown";
      const settings = !isComposite && column.isPk ? " [pk]" : "";
      lines.push(`  ${quoteDbmlIdent(column.name)} ${type}${settings}`);
    }

    if (isComposite) {
      lines.push(
        "",
        "  Indexes {",
        `    (${pkColumns.map(quoteDbmlIdent).join(", ")}) [pk]`,
        "  }",
      );
    }

    lines.push("}");
    blocks.push(lines.join("\n"));
  }

  const refs: string[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) continue;

    const child = `${quoteDbmlIdent(edge.source)}.${quoteDbmlIdent(String(edge.sourceHandle))}`;
    const parent = `${quoteDbmlIdent(edge.target)}.${quoteDbmlIdent(String(edge.targetHandle))}`;
    const ref = `Ref: ${child} > ${parent}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }

  const out = [...blocks];
  if (refs.length > 0) out.push(refs.join("\n"));
  return out.join("\n\n") + "\n";
};
