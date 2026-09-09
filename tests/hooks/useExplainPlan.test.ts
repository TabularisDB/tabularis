import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { parseExplain, type ExplainPlan, type ExplainQueryOutput } from "@tabularis/explain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExplainPlan } from "../../src/hooks/useExplainPlan";
import * as sql from "../../src/utils/sql";

vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makePlan(id: string): ExplainPlan {
  const plan = parseExplain('[{"Plan":{"Node Type":"Result"}}]');
  return { ...plan, root: { ...plan.root, id }, original_query: id };
}

const args = { connectionId: "connection-1", query: "SELECT 1" };

describe("useExplainPlan", () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); });
  afterEach(() => vi.restoreAllMocks());

  it("starts empty without invoking", () => {
    const { result } = renderHook(() => useExplainPlan());
    expect(result.current).toMatchObject({
      plan: null, isLoading: false, error: null, selectedNodeId: null, viewMode: "graph",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("initializes a supplied plan and retains stable callbacks and compatibility setters", () => {
    const initialPlan = makePlan("initial");
    const { result, rerender } = renderHook(({ plan }) => useExplainPlan(plan), {
      initialProps: { plan: initialPlan },
    });
    const initial = result.current;
    expect(initial.plan).toBe(initialPlan);
    expect(initial.selectedNodeId).toBe("initial");
    act(() => {
      initial.setViewMode("table");
      initial.setSelectedNodeId("child");
      initial.setError("manual error");
      initial.setIsLoading(true);
      initial.setPlan(initialPlan);
    });
    rerender({ plan: makePlan("ignored-after-mount") });
    expect(result.current).toMatchObject({
      plan: initialPlan, selectedNodeId: "child", error: "manual error", isLoading: true,
      viewMode: "table",
    });
    expect(result.current.runExplain).toBe(initial.runExplain);
    expect(result.current.loadPlan).toBe(initial.loadPlan);
    expect(result.current.invalidate).toBe(initial.invalidate);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    { options: {}, expected: { analyze: false, schema: null } },
    { options: { analyze: true, schema: "analytics" }, expected: { analyze: true, schema: "analytics" } },
    { options: { analyze: false, schema: "" }, expected: { analyze: false, schema: null } },
  ])("preserves invoke defaults and explicit options: $expected", async ({ options, expected }) => {
    const plan = makePlan("resolved");
    vi.mocked(invoke).mockResolvedValue({ kind: "plan", plan });
    const { result } = renderHook(() => useExplainPlan());
    await act(async () => { await result.current.runExplain({ ...args, ...options }); });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("explain_query_plan", { ...args, ...expected });
    expect(result.current).toMatchObject({ plan, selectedNodeId: "resolved", error: null, isLoading: false });
  });

  it("resolves raw driver output through the parser", async () => {
    vi.mocked(invoke).mockResolvedValue({
      kind: "raw",
      raw: { engine: "postgres", format: "postgres-json", payload: '[{"Plan":{"Node Type":"Result"}}]', original_query: "SELECT 1" },
    });
    const { result } = renderHook(() => useExplainPlan());
    await act(async () => { await result.current.runExplain(args); });
    expect(result.current.plan?.root.node_type).toBe("Result");
    expect(result.current.plan?.original_query).toBe("SELECT 1");
    expect(result.current.selectedNodeId).toBe(result.current.plan?.root.id);
  });

  it.each([
    { connectionId: "", query: "SELECT 1", error: null },
    { connectionId: "   ", query: "SELECT 1", error: null },
    { connectionId: "connection-1", query: " \n ", error: null },
    { connectionId: "connection-1", query: "VACUUM", error: "editor.visualExplain.notExplainable" },
  ])("clears prior state without invoking invalid input: $query / $connectionId", async ({ error, ...input }) => {
    const { result } = renderHook(() => useExplainPlan(makePlan("initial")));
    act(() => { result.current.setError("old error"); });
    await act(async () => { await result.current.runExplain(input); });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ plan: null, selectedNodeId: null, error, isLoading: false });
  });

  it("clears the plan, selection and error when a new load starts", async () => {
    const pending = createDeferred<ExplainPlan>();
    const { result } = renderHook(() => useExplainPlan(makePlan("old")));
    act(() => { result.current.setError("old failure"); });
    let request!: Promise<void>;
    act(() => { request = result.current.loadPlan(() => pending.promise); });
    expect(result.current).toMatchObject({ plan: null, selectedNodeId: null, error: null, isLoading: true });
    await act(async () => { pending.resolve(makePlan("new")); await request; });
    expect(result.current.selectedNodeId).toBe("new");
    expect(result.current.isLoading).toBe(false);
  });

  describe.each(["explain", "file"] as const)("when the older request is %s", (olderSource) => {
    it.each(["resolve", "reject"] as const)("ignores its stale %s after the newer request succeeds", async (outcome) => {
      const explain = createDeferred<ExplainQueryOutput>();
      const file = createDeferred<ExplainPlan>();
      vi.mocked(invoke).mockReturnValue(explain.promise);
      const { result } = renderHook(() => useExplainPlan());
      const startExplain = () => result.current.runExplain(args);
      const startFile = () => result.current.loadPlan(() => file.promise);
      let older!: Promise<void>;
      let newer!: Promise<void>;
      act(() => {
        older = olderSource === "explain" ? startExplain() : startFile();
        newer = olderSource === "explain" ? startFile() : startExplain();
      });
      const latest = makePlan("latest");
      await act(async () => {
        if (olderSource === "explain") file.resolve(latest);
        else explain.resolve({ kind: "plan", plan: latest });
        await newer;
      });
      await act(async () => {
        if (outcome === "reject") {
          (olderSource === "explain" ? explain : file).reject(new Error("stale failure"));
        } else if (olderSource === "explain") {
          explain.resolve({ kind: "plan", plan: makePlan("old") });
        } else {
          file.resolve(makePlan("old"));
        }
        await older;
      });
      expect(result.current).toMatchObject({ plan: latest, selectedNodeId: "latest", error: null, isLoading: false });
    });
  });

  it.each(["resolve", "reject"] as const)("does not stop the latest loading state on an older %s", async (outcome) => {
    const first = createDeferred<ExplainPlan>();
    const second = createDeferred<ExplainPlan>();
    const { result } = renderHook(() => useExplainPlan());
    let older!: Promise<void>;
    let newer!: Promise<void>;
    act(() => {
      older = result.current.loadPlan(() => first.promise);
      newer = result.current.loadPlan(() => second.promise);
    });
    await act(async () => {
      if (outcome === "resolve") first.resolve(makePlan("old"));
      else first.reject("old error");
      await older;
    });
    expect(result.current).toMatchObject({ plan: null, error: null, selectedNodeId: null, isLoading: true });
    await act(async () => { second.resolve(makePlan("latest")); await newer; });
    expect(result.current.isLoading).toBe(false);
  });

  it("preserves the latest error when an older success arrives", async () => {
    const old = createDeferred<ExplainPlan>();
    const { result } = renderHook(() => useExplainPlan());
    let older!: Promise<void>;
    act(() => { older = result.current.loadPlan(() => old.promise); });
    await act(async () => { await result.current.loadPlan(async () => { throw new Error("latest failure"); }); });
    await act(async () => { old.resolve(makePlan("old")); await older; });
    expect(result.current).toMatchObject({ plan: null, error: "Error: latest failure", selectedNodeId: null, isLoading: false });
    await act(async () => { await result.current.loadPlan(async () => makePlan("recovered")); });
    expect(result.current.error).toBeNull();
    expect(result.current.selectedNodeId).toBe("recovered");
  });

  it.each(["", "VACUUM"])("invalidates pending work when resetting with %j", async (query) => {
    const old = createDeferred<ExplainPlan>();
    const { result } = renderHook(() => useExplainPlan());
    let older!: Promise<void>;
    act(() => { older = result.current.loadPlan(() => old.promise); });
    await act(async () => { await result.current.runExplain({ ...args, query }); });
    await act(async () => { old.resolve(makePlan("obsolete")); await older; });
    expect(result.current).toMatchObject({ plan: null, selectedNodeId: null, isLoading: false });
    expect(result.current.error).toBe(query ? "editor.visualExplain.notExplainable" : null);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("captures validation exceptions in the shared lifecycle", async () => {
    vi.spyOn(sql, "isExplainableQuery").mockImplementationOnce(() => { throw new Error("validation failed"); });
    const { result } = renderHook(() => useExplainPlan(makePlan("initial")));
    await act(async () => { await result.current.runExplain(args); });
    expect(result.current).toMatchObject({ plan: null, selectedNodeId: null, isLoading: false, error: "Error: validation failed" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("captures parsing failures in the shared lifecycle", async () => {
    vi.mocked(invoke).mockResolvedValue({
      kind: "raw", raw: { engine: "postgres", format: "postgres-json", payload: "not json", original_query: "SELECT 1" },
    });
    const { result } = renderHook(() => useExplainPlan(makePlan("initial")));
    await act(async () => { await result.current.runExplain(args); });
    expect(result.current).toMatchObject({ plan: null, selectedNodeId: null, isLoading: false });
    expect(result.current.error).toBeTruthy();
  });

  it("invalidates without synchronously updating state", async () => {
    const deferred = createDeferred<ExplainPlan>();
    const { result } = renderHook(() => useExplainPlan());
    let pending!: Promise<void>;
    act(() => { pending = result.current.loadPlan(() => deferred.promise); });
    const snapshot = result.current;
    act(() => { result.current.invalidate(); });
    expect(result.current).toBe(snapshot);
    await act(async () => { deferred.resolve(makePlan("discarded")); await pending; });
    expect(result.current).toBe(snapshot);
  });

  it.each(["resolve", "reject"] as const)("discards a pending %s after unmount", async (outcome) => {
    const deferred = createDeferred<ExplainPlan>();
    const { result, unmount } = renderHook(() => useExplainPlan());
    let pending!: Promise<void>;
    act(() => { pending = result.current.loadPlan(() => deferred.promise); });
    const snapshot = result.current;
    unmount();
    await act(async () => {
      if (outcome === "resolve") deferred.resolve(makePlan("discarded"));
      else deferred.reject(new Error("discarded failure"));
      await pending;
    });
    expect(result.current).toBe(snapshot);
    const operation = vi.fn(async () => makePlan("after unmount"));
    await result.current.loadPlan(operation);
    expect(operation).not.toHaveBeenCalled();
  });
});