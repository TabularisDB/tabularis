export interface ResourceSnapshot<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

/** A per-window resource: concurrent readers share requests and refreshes. */
export function createAsyncResource<T>(initial: T, fetchData: () => Promise<T>) {
  let snapshot: ResourceSnapshot<T> = { data: initial, loading: true, error: null };
  const listeners = new Set<() => void>();
  let request: Promise<void> | null = null;
  let loaded = false;
  let dirty = false;

  const publish = (next: ResourceSnapshot<T>) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const load = (refresh = false): Promise<void> => {
    if (refresh) dirty = true;
    if (request) return request;
    if (loaded && !dirty) return Promise.resolve();
    // Defer notifications so subscribing during a React commit is safe.
    request = Promise.resolve().then(async () => {
      try {
        do {
          dirty = false;
          publish({ ...snapshot, loading: true, error: null });
          try {
            const data = await fetchData();
            loaded = true;
            publish({ data, loading: false, error: null });
          } catch (error) {
            loaded = false;
            publish({ ...snapshot, loading: false, error: String(error) });
          }
          // An activation/refresh during a read must not leave a stale result.
        } while (dirty);
      } finally {
        // Clear before yielding so a late refresh starts a new request.
        request = null;
      }
    });
    return request;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load: () => load(),
    refresh: () => load(true),
  };
}
