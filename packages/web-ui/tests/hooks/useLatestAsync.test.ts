import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLatestAsync } from "../../src/hooks/useLatestAsync";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe("useLatestAsync", () => {
  it("returns stale for an older request under the same key", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const { result } = renderHook(() => useLatestAsync());

    const firstResult = result.current.run("contexts", () => first.promise);
    const secondResult = result.current.run("contexts", () => second.promise);

    await act(async () => {
      second.resolve("newest");
    });
    await expect(secondResult).resolves.toEqual({
      status: "success",
      value: "newest",
    });

    await act(async () => {
      first.resolve("older");
    });
    await expect(firstResult).resolves.toEqual({ status: "stale" });
  });

  it("keeps requests under independent keys active", async () => {
    const contexts = createDeferred<string[]>();
    const namespaces = createDeferred<string[]>();
    const { result } = renderHook(() => useLatestAsync());

    const contextsResult = result.current.run("contexts", () => contexts.promise);
    const namespacesResult = result.current.run("namespaces", () => namespaces.promise);

    await act(async () => {
      namespaces.resolve(["default"]);
      contexts.resolve(["minikube"]);
    });

    await expect(contextsResult).resolves.toEqual({
      status: "success",
      value: ["minikube"],
    });
    await expect(namespacesResult).resolves.toEqual({
      status: "success",
      value: ["default"],
    });
  });

  it("invalidates an active request explicitly", async () => {
    const deferred = createDeferred<string>();
    const { result } = renderHook(() => useLatestAsync());

    const pending = result.current.run("resources", () => deferred.promise);
    act(() => {
      result.current.invalidate("resources");
    });

    await act(async () => {
      deferred.resolve("mysql");
    });

    await expect(pending).resolves.toEqual({ status: "stale" });
  });

  it("suppresses stale rejections", async () => {
    const stale = createDeferred<string>();
    const newest = createDeferred<string>();
    const { result } = renderHook(() => useLatestAsync());

    const staleResult = result.current.run("ports", () => stale.promise);
    const newestResult = result.current.run("ports", () => newest.promise);

    await act(async () => {
      stale.reject(new Error("obsolete failure"));
      newest.resolve("5432");
    });

    await expect(staleResult).resolves.toEqual({ status: "stale" });
    await expect(newestResult).resolves.toEqual({
      status: "success",
      value: "5432",
    });
  });

  it("invalidates all active requests on unmount", async () => {
    const deferred = createDeferred<string>();
    const { result, unmount } = renderHook(() => useLatestAsync());

    const pending = result.current.run("contexts", () => deferred.promise);
    unmount();

    await act(async () => {
      deferred.resolve("minikube");
    });

    await expect(pending).resolves.toEqual({ status: "stale" });
  });
});
