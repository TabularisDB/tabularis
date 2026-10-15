import { useCallback, useEffect, useMemo, useRef } from "react";

export type LatestAsyncResult<T> =
  | { status: "success"; value: T }
  | { status: "error"; error: unknown }
  | { status: "stale" };

interface LatestAsyncController {
  run: <T>(
    key: string,
    operation: () => Promise<T>,
  ) => Promise<LatestAsyncResult<T>>;
  invalidate: (key: string) => void;
}

/**
 * Runs keyed asynchronous work where only the most recent result for each key
 * may update UI state. Consumers inspect the returned discriminated result,
 * so stale resolutions and rejections are handled consistently.
 */
export function useLatestAsync(): LatestAsyncController {
  const mountedRef = useRef(true);
  const sequenceRef = useRef(0);
  const tokensRef = useRef(new Map<string, number>());

  useEffect(() => {
    mountedRef.current = true;
    const tokens = tokensRef.current;

    return () => {
      mountedRef.current = false;
      tokens.clear();
    };
  }, []);

  const invalidate = useCallback((key: string) => {
    tokensRef.current.set(key, ++sequenceRef.current);
  }, []);

  const run = useCallback(
    async <T>(
      key: string,
      operation: () => Promise<T>,
    ): Promise<LatestAsyncResult<T>> => {
      if (!mountedRef.current) {
        return { status: "stale" };
      }

      const token = ++sequenceRef.current;
      tokensRef.current.set(key, token);

      try {
        const value = await operation();
        return mountedRef.current && tokensRef.current.get(key) === token
          ? { status: "success", value }
          : { status: "stale" };
      } catch (error) {
        return mountedRef.current && tokensRef.current.get(key) === token
          ? { status: "error", error }
          : { status: "stale" };
      }
    },
    [],
  );

  return useMemo(
    () => ({ run, invalidate }),
    [invalidate, run],
  );
}
