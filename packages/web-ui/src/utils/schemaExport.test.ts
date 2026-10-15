import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import {
  generateMermaidErDiagram,
  generateDbml,
  sanitizeMermaidId,
} from "./schemaExport";

const node = (
  id: string,
  columns: Array<{
    name: string;
    type?: string;
    isPk?: boolean;
    isFk?: boolean;
  }>,
): Node =>
  ({
    id,
    type: "schemaTable",
    position: { x: 0, y: 0 },
    data: { label: id, columns },
  }) as Node;

const edge = (
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string,
): Edge =>
  ({
    id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
    source,
    target,
    sourceHandle,
    targetHandle,
  }) as Edge;

describe("sanitizeMermaidId", () => {
  it("replaces characters Mermaid cannot parse in identifiers", () => {
    expect(sanitizeMermaidId("order details")).toBe("order_details");
    expect(sanitizeMermaidId("public.users")).toBe("public_users");
  });

  it("prefixes identifiers starting with a digit", () => {
    expect(sanitizeMermaidId("2fa_tokens")).toBe("t_2fa_tokens");
  });
});

describe("generateMermaidErDiagram", () => {
  it("emits a table block with typed columns and key markers", () => {
    const result = generateMermaidErDiagram(
      [
        node("users", [
          { name: "id", type: "int", isPk: true },
          { name: "email", type: "varchar" },
        ]),
      ],
      [],
    );

    expect(result).toBe(
      [
        "erDiagram",
        "    users {",
        "        int id PK",
        "        varchar email",
        "    }",
        "",
      ].join("\n"),
    );
  });

  it("marks a column that is both primary and foreign key", () => {
    const result = generateMermaidErDiagram(
      [node("profiles", [{ name: "user_id", type: "int", isPk: true, isFk: true }])],
      [],
    );

    expect(result).toContain("int user_id PK,FK");
  });

  it("points the relationship from the referenced table to the child table", () => {
    const result = generateMermaidErDiagram(
      [
        node("users", [{ name: "id", type: "int", isPk: true }]),
        node("orders", [{ name: "user_id", type: "int", isFk: true }]),
      ],
      [edge("orders", "users", "user_id", "id")],
    );

    expect(result).toContain('    users ||--o{ orders : "user_id"');
  });

  it("does not repeat a relationship when the same edge appears twice", () => {
    const result = generateMermaidErDiagram(
      [node("users", []), node("orders", [])],
      [
        edge("orders", "users", "user_id", "id"),
        edge("orders", "users", "user_id", "id"),
      ],
    );

    const occurrences = result
      .split("\n")
      .filter((line) => line.includes("||--o{")).length;
    expect(occurrences).toBe(1);
  });

  it("falls back to a placeholder type when the column type is missing", () => {
    const result = generateMermaidErDiagram(
      [node("logs", [{ name: "payload" }])],
      [],
    );

    expect(result).toContain("unknown payload");
  });

  it("emits an empty block for a table without columns", () => {
    const result = generateMermaidErDiagram([node("empty_table", [])], []);

    expect(result).toBe(
      ["erDiagram", "    empty_table {", "    }", ""].join("\n"),
    );
  });
});

describe("generateDbml", () => {
  it("marks a single primary key inline", () => {
    const result = generateDbml(
      [
        node("users", [
          { name: "id", type: "int", isPk: true },
          { name: "email", type: "varchar" },
        ]),
      ],
      [],
    );

    expect(result).toContain("Table users {");
    expect(result).toContain("  id int [pk]");
    expect(result).toContain("  email varchar");
  });

  it("uses an Indexes block for a composite primary key", () => {
    const result = generateDbml(
      [
        node("lignes_commande", [
          { name: "commande_id", type: "int", isPk: true },
          { name: "produit_id", type: "int", isPk: true },
          { name: "quantite", type: "int" },
        ]),
      ],
      [],
    );

    // Inline [pk] cannot express a composite key, so it must not appear.
    expect(result).not.toContain("[pk]\n  produit_id");
    expect(result).toContain("  Indexes {");
    expect(result).toContain("    (commande_id, produit_id) [pk]");
  });

  it("keeps both endpoints of a foreign key", () => {
    const result = generateDbml(
      [node("orders", []), node("users", [])],
      [edge("orders", "users", "user_id", "id")],
    );

    expect(result).toContain("Ref: orders.user_id > users.id");
  });

  it("emits one ref per distinct foreign key", () => {
    const result = generateDbml(
      [node("lignes", []), node("commandes", []), node("produits", [])],
      [
        edge("lignes", "commandes", "commande_id", "id"),
        edge("lignes", "produits", "produit_id", "id"),
        edge("lignes", "commandes", "commande_id", "id"),
      ],
    );

    const refs = result.split("\n").filter((l) => l.startsWith("Ref:"));
    expect(refs).toEqual([
      "Ref: lignes.commande_id > commandes.id",
      "Ref: lignes.produit_id > produits.id",
    ]);
  });

  it("quotes identifiers that are not plain words", () => {
    const result = generateDbml(
      [node("order details", [{ name: "unit price", type: "decimal" }])],
      [],
    );

    expect(result).toContain('Table "order details" {');
    expect(result).toContain('  "unit price" decimal');
  });

  it("falls back to a placeholder type when the column type is missing", () => {
    const result = generateDbml([node("logs", [{ name: "payload" }])], []);

    expect(result).toContain("  payload unknown");
  });
});
