import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useExplainAnalyze } from "../../src/hooks/useExplainAnalyze";

const sourceKeyOf = (source: {
  connectionId: string;
  query: string;
  schema?: string | null;
}) => renderHook(() => useExplainAnalyze(source)).result.current.sourceKey;

const source = { connectionId: "connection-1", query: "SELECT * FROM widgets", schema: "analytics" };
const writes = [
  "INSERT INTO widgets (id) VALUES (1)",
  "UPDATE widgets SET name = 'new'",
  "DELETE FROM widgets WHERE id = 1",
  "DROP TABLE widgets",
  "ALTER TABLE widgets ADD COLUMN name TEXT",
  "TRUNCATE widgets",
];

describe("useExplainAnalyze", () => {
  describe("sourceKey", () => {
    it.each([
      { name: "an omitted schema", schema: undefined },
      { name: "a null schema", schema: null },
    ])("treats $name as the same source", ({ schema }) => {
      expect(sourceKeyOf({ connectionId: "c", query: "SELECT 1", schema })).toBe(
        sourceKeyOf({ connectionId: "c", query: "SELECT 1", schema: null }),
      );
    });

    it.each([
      { field: "connection", change: { connectionId: "connection-2" } },
      { field: "query", change: { query: "SELECT 2" } },
      { field: "schema", change: { schema: "reporting" } },
    ])("changes with the $field", ({ change }) => {
      const base = { connectionId: "connection-1", query: "SELECT 1", schema: "analytics" };
      expect(sourceKeyOf({ ...base, ...change })).not.toBe(sourceKeyOf(base));
    });
  });

  it("defaults to off and reports a plain query", () => {
    const { result } = renderHook(() => useExplainAnalyze(source));
    expect(result.current).toMatchObject({ analyze: false, isDml: false });
    expect(result.current.sourceKey).toBe(sourceKeyOf(source));
  });

  it.each([true, false])("defaults a plain query to defaultEnabled=%s", (defaultEnabled) => {
    const { result } = renderHook(() => useExplainAnalyze({ ...source, defaultEnabled }));
    expect(result.current.analyze).toBe(defaultEnabled);
  });

  it.each(writes)("never defaults a data-modifying query on: %s", (query) => {
    const { result } = renderHook(() =>
      useExplainAnalyze({ ...source, query, defaultEnabled: true }),
    );
    expect(result.current).toMatchObject({ analyze: false, isDml: true });
  });

  it("keeps an explicit choice while the source is unchanged", () => {
    const { result, rerender } = renderHook(() => useExplainAnalyze(source));
    act(() => result.current.setAnalyze(true));
    expect(result.current.analyze).toBe(true);
    rerender();
    expect(result.current.analyze).toBe(true);
    act(() => result.current.setAnalyze(false));
    expect(result.current.analyze).toBe(false);
  });

  it.each([
    { field: "query", change: { query: "SELECT id FROM widgets" } },
    { field: "schema", change: { schema: "reporting" } },
    { field: "connection", change: { connectionId: "connection-2" } },
  ])("drops an opt-in when the $field changes", ({ change }) => {
    const { result, rerender } = renderHook((props) => useExplainAnalyze(props), {
      initialProps: source,
    });
    act(() => result.current.setAnalyze(true));
    rerender({ ...source, ...change });
    expect(result.current.analyze).toBe(false);
    rerender(source);
    expect(result.current.analyze).toBe(false);
  });

  it.each(writes)("forces the opt-in off once the query becomes: %s", (query) => {
    const { result, rerender } = renderHook((props) => useExplainAnalyze(props), {
      initialProps: { ...source, defaultEnabled: true },
    });
    expect(result.current.analyze).toBe(true);
    act(() => result.current.setAnalyze(true));
    rerender({ ...source, query, defaultEnabled: true });
    expect(result.current).toMatchObject({ analyze: false, isDml: true });
  });

  it("analyzes a data-modifying query only after an explicit opt-in for it", () => {
    const query = "UPDATE widgets SET name = 'new'";
    const { result, rerender } = renderHook((props) => useExplainAnalyze(props), {
      initialProps: { ...source, query },
    });
    expect(result.current.analyze).toBe(false);
    act(() => result.current.setAnalyze(true));
    expect(result.current.analyze).toBe(true);
    rerender({ ...source, query: "UPDATE widgets SET name = 'other'" });
    expect(result.current.analyze).toBe(false);
  });
});
