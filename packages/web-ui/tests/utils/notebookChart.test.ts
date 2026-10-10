import { describe, it, expect } from "vitest";
import {
  canRenderChart,
  getNumericColumns,
  getLabelColumns,
  buildDefaultChartConfig,
  transformResultToChartData,
} from "../../src/utils/notebookChart";
import type { QueryResult } from "../../src/types/editor";
import type { CellChartConfig } from "../../src/types/notebook";

function makeResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: ["name", "sales", "profit"],
    rows: [
      ["Alice", 100, 40],
      ["Bob", 200, 80],
      ["Carol", 150, 60],
    ],
    affected_rows: 0,
    ...overrides,
  };
}

describe("notebookChart", () => {
  describe("canRenderChart", () => {
    it("should return true for result with >= 2 columns and rows", () => {
      expect(canRenderChart(makeResult())).toBe(true);
    });

    it("should return false for single column", () => {
      expect(
        canRenderChart(makeResult({ columns: ["a"], rows: [[1]] })),
      ).toBe(false);
    });

    it("should return false for empty rows", () => {
      expect(
        canRenderChart(makeResult({ columns: ["a", "b"], rows: [] })),
      ).toBe(false);
    });
  });

  describe("getNumericColumns", () => {
    it("should return columns that have numeric values", () => {
      const cols = getNumericColumns(makeResult());
      expect(cols).toContain("sales");
      expect(cols).toContain("profit");
      expect(cols).not.toContain("name");
    });

    it("should return empty for no rows", () => {
      expect(getNumericColumns(makeResult({ rows: [] }))).toEqual([]);
    });

    it("should return empty when no numeric columns exist", () => {
      expect(
        getNumericColumns(
          makeResult({ columns: ["a", "b"], rows: [["x", "y"]] }),
        ),
      ).toEqual([]);
    });
  });

  describe("getLabelColumns", () => {
    it("should return columns that have string values", () => {
      const cols = getLabelColumns(makeResult());
      expect(cols).toContain("name");
      expect(cols).not.toContain("sales");
    });

    it("should return empty for no rows", () => {
      expect(getLabelColumns(makeResult({ rows: [] }))).toEqual([]);
    });
  });

  describe("buildDefaultChartConfig", () => {
    it("should build config with first label and first numeric column", () => {
      const config = buildDefaultChartConfig(makeResult());
      expect(config).not.toBeNull();
      expect(config!.type).toBe("bar");
      expect(config!.labelColumn).toBe("name");
      expect(config!.valueColumns).toEqual(["sales"]);
    });

    it("should return null if no label columns", () => {
      const config = buildDefaultChartConfig(
        makeResult({ columns: ["a", "b"], rows: [[1, 2]] }),
      );
      expect(config).toBeNull();
    });

    it("should return null if no numeric columns", () => {
      const config = buildDefaultChartConfig(
        makeResult({ columns: ["a", "b"], rows: [["x", "y"]] }),
      );
      expect(config).toBeNull();
    });
  });

  describe("transformResultToChartData", () => {
    it("should transform rows into chart data points", () => {
      const config: CellChartConfig = {
        type: "bar",
        labelColumn: "name",
        valueColumns: ["sales"],
      };
      const data = transformResultToChartData(makeResult(), config);
      expect(data).toHaveLength(3);
      expect(data[0]).toEqual({ label: "Alice", sales: 100 });
      expect(data[1]).toEqual({ label: "Bob", sales: 200 });
    });

    it("should handle multiple value columns", () => {
      const config: CellChartConfig = {
        type: "bar",
        labelColumn: "name",
        valueColumns: ["sales", "profit"],
      };
      const data = transformResultToChartData(makeResult(), config);
      expect(data[0]).toEqual({ label: "Alice", sales: 100, profit: 40 });
    });

    it("should return empty array for invalid label column", () => {
      const config: CellChartConfig = {
        type: "bar",
        labelColumn: "nonexistent",
        valueColumns: ["sales"],
      };
      expect(transformResultToChartData(makeResult(), config)).toEqual([]);
    });

    it("should skip invalid value columns", () => {
      const config: CellChartConfig = {
        type: "bar",
        labelColumn: "name",
        valueColumns: ["nonexistent"],
      };
      expect(transformResultToChartData(makeResult(), config)).toEqual([]);
    });

    it("should coerce non-numeric values to 0", () => {
      const result = makeResult({
        columns: ["name", "value"],
        rows: [["Alice", "not_a_number"]],
      });
      const config: CellChartConfig = {
        type: "bar",
        labelColumn: "name",
        valueColumns: ["value"],
      };
      const data = transformResultToChartData(result, config);
      expect(data[0].value).toBe(0);
    });

    it("should handle null label values", () => {
      const result = makeResult({
        columns: ["name", "value"],
        rows: [[null, 10]],
      });
      const config: CellChartConfig = {
        type: "bar",
        labelColumn: "name",
        valueColumns: ["value"],
      };
      const data = transformResultToChartData(result, config);
      expect(data[0].label).toBe("");
    });
  });
});
