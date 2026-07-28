import { describe, expect, it } from "vitest";
import {
  buildSqliteTree,
  parseSqliteDetail,
  parseSqliteEqpRows,
} from "../../src/parsers/sqlite";
import { NodeIdAllocator } from "../../src/parsers/node";

describe("sqlite parsers", () => {
  describe("parseSqliteDetail", () => {
    it("parses a search with an integer primary key", () => {
      const [nodeType, relation, indexCondition] = parseSqliteDetail(
        "SEARCH users USING INTEGER PRIMARY KEY (rowid=?)",
      );

      expect(nodeType).toBe("Search");
      expect(relation).toBe("users");
      expect(indexCondition).toBe("PRIMARY KEY");
    });

    it("parses a scan with a covering index", () => {
      const [nodeType, relation, indexCondition] = parseSqliteDetail(
        "SCAN users USING COVERING INDEX idx_users_name",
      );

      expect(nodeType).toBe("Scan");
      expect(relation).toBe("users");
      expect(indexCondition).toBe("idx_users_name");
    });
  });

  describe("buildSqliteTree", () => {
    it("builds a tree from nested entries", () => {
      const entries = [
        { id: 0, parent: 0, detail: "SCAN users" },
        { id: 1, parent: 0, detail: "SEARCH posts USING INDEX idx_posts_user_id" },
        { id: 2, parent: 1, detail: "USE TEMP B-TREE FOR ORDER BY" },
      ];

      const root = buildSqliteTree(entries, 0, new NodeIdAllocator());

      expect(root.node_type).toBe("Scan");
      expect(root.relation).toBe("users");
      expect(root.children).toHaveLength(1);
      expect(root.children[0].node_type).toBe("Search");
      expect(root.children[0].relation).toBe("posts");
      expect(root.children[0].index_condition).toBe("idx_posts_user_id");
      expect(root.children[0].children).toHaveLength(1);
      expect(root.children[0].children[0].node_type).toBe("Sort");
    });
  });

  describe("parseSqliteEqpRows", () => {
    it("wraps the tree in a plan and rebuilds the raw output", () => {
      const plan = parseSqliteEqpRows([
        { id: 0, parent: 0, detail: "SCAN users" },
        { id: 1, parent: 0, detail: "USE TEMP B-TREE FOR ORDER BY" },
      ]);

      expect(plan.driver).toBe("sqlite");
      expect(plan.has_analyze_data).toBe(false);
      expect(plan.root.node_type).toBe("Scan");
      expect(plan.raw_output).toBe(
        "0|0|SCAN users\n1|0|USE TEMP B-TREE FOR ORDER BY",
      );
    });

    it("rejects an empty row set", () => {
      expect(() => parseSqliteEqpRows([])).toThrow(/no output/);
    });
  });
});
