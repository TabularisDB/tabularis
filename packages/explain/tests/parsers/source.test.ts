import { describe, expect, it } from "vitest";
import {
  detectFormat,
  detectFormatFor,
  explainEngineFromDriverName,
  parseExplain,
  parseExplainFor,
  withSourceLabel,
} from "../../src/parsers/source";

const MYSQL_JSON = `{
  "query_block": {
    "select_id": 1,
    "cost_info": { "query_cost": "12.34" },
    "table": {
      "table_name": "users",
      "access_type": "ALL",
      "rows_examined_per_scan": 100,
      "filtered": "100.00"
    }
  }
}`;

const MARIADB_ANALYZE_JSON = `{
  "query_optimization": { "r_total_time_ms": 1.875 },
  "query_block": {
    "select_id": 1,
    "r_loops": 1,
    "table": {
      "table_name": "orders",
      "access_type": "ALL",
      "r_rows": 4200,
      "r_total_time_ms": 31.5
    }
  }
}`;

const MYSQL_TEXT =
  "-> Nested loop inner join  (cost=10.00 rows=5) (actual time=0.50..1.20 rows=5 loops=1)\n    -> Table scan on t  (cost=1.00 rows=5) (actual time=0.10..0.20 rows=5 loops=1)";

const POSTGRES_JSON = `[{ "Plan": { "Node Type": "Seq Scan", "Relation Name": "users" } }]`;

const POSTGRES_TEXT = " Seq Scan on users  (cost=0.00..12.34 rows=100 width=80)\n";

describe("source dispatch", () => {
  describe("an engine hint reaches parsers that sniffing cannot", () => {
    it("parses MySQL JSON when the engine is given", () => {
      const plan = parseExplainFor(MYSQL_JSON, "mysql");

      expect(plan.driver).toBe("mysql");
      expect(plan.root.relation).toBe("users");
      expect(plan.has_analyze_data).toBe(false);
      expect(plan.original_query, "the caller owns the statement").toBe("");
      expect(plan.raw_output).not.toBeNull();
    });

    it("keeps MariaDB optimizer time as planning time", () => {
      const plan = parseExplainFor(MARIADB_ANALYZE_JSON, "mysql");

      expect(plan.planning_time_ms).toBe(1.875);
      expect(plan.has_analyze_data, "r_* fields are actual data").toBe(true);
      expect(plan.root.relation).toBe("orders");
    });

    it("parses MySQL text when the engine is given", () => {
      const plan = parseExplainFor(MYSQL_TEXT, "mysql");

      expect(plan.driver).toBe("mysql");
      expect(plan.root.node_type).toBe("Nested Loop");
      expect(plan.has_analyze_data).toBe(true);
    });

    it("still fails on MySQL JSON without a hint, as before", () => {
      // Sniffing sees a leading `{` and tries Postgres, which has no `Plan` key.
      expect(() => parseExplain(MYSQL_JSON)).toThrow(/Plan/);
    });
  });

  describe("the unhinted path is unchanged", () => {
    it("matches the previous sniffing behaviour", () => {
      expect(detectFormat(POSTGRES_JSON)).toBe("postgres-json");
      expect(detectFormat(POSTGRES_TEXT)).toBe("postgres-text");
      expect(detectFormatFor(POSTGRES_JSON, null)).toBe(detectFormat(POSTGRES_JSON));
      expect(() => detectFormat("not a plan at all")).toThrow(/Unsupported/);
    });

    it("agrees with sniffing when a postgres hint is given", () => {
      for (const raw of [POSTGRES_JSON, POSTGRES_TEXT]) {
        expect(detectFormatFor(raw, "postgres")).toBe(detectFormat(raw));
      }
      const plan = parseExplainFor(POSTGRES_JSON, "postgres");
      expect(plan.driver).toBe("postgres");
    });
  });

  describe("edges", () => {
    it("reports that sqlite has no text form", () => {
      expect(() => parseExplainFor("SCAN users", "sqlite")).toThrow(
        /buildSqliteTree/,
      );
    });

    it("rejects empty input for every engine", () => {
      expect(() => parseExplainFor("", null)).toThrow();
      expect(() => parseExplainFor("", "postgres")).toThrow();
      expect(() => parseExplainFor("   \n ", "mysql")).toThrow();
    });

    it("reports MySQL JSON missing its query_block", () => {
      expect(() => parseExplainFor('{"not_a_block": 1}', "mysql")).toThrow(
        /query_block/,
      );
    });

    it("maps driver names onto engines", () => {
      expect(explainEngineFromDriverName("postgres")).toBe("postgres");
      expect(explainEngineFromDriverName("PostgreSQL")).toBe("postgres");
      expect(explainEngineFromDriverName("mysql")).toBe("mysql");
      expect(
        explainEngineFromDriverName(" MariaDB "),
        "MariaDB shares every MySQL plan format",
      ).toBe("mysql");
      expect(explainEngineFromDriverName("sqlite")).toBe("sqlite");
      expect(explainEngineFromDriverName("oracle")).toBeNull();
      expect(explainEngineFromDriverName("")).toBeNull();
    });
  });

  describe("withSourceLabel", () => {
    it("labels a plan with an empty original query", () => {
      const plan = parseExplainFor(POSTGRES_JSON, "postgres");
      const labelled = withSourceLabel(plan, "plan.json");
      expect(labelled.original_query).toBe("-- loaded from plan.json");
    });

    it("leaves a stamped original query alone", () => {
      const plan = {
        ...parseExplainFor(POSTGRES_JSON, "postgres"),
        original_query: "SELECT 1",
      };
      expect(withSourceLabel(plan, "plan.json").original_query).toBe("SELECT 1");
    });
  });
});
