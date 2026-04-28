export interface QueryStats {
  rows: number | null;
  durationMs: number;
  error: string | null;
  at: number;
}

const EVENT_NAME = 'tabularis:query-stats';

export function dispatchQueryStats(stats: Omit<QueryStats, 'at'>): void {
  window.dispatchEvent(
    new CustomEvent<QueryStats>(EVENT_NAME, {
      detail: { ...stats, at: Date.now() },
    }),
  );
}

export function onQueryStats(handler: (stats: QueryStats) => void): () => void {
  const listener = (e: Event) => {
    const ev = e as CustomEvent<QueryStats>;
    handler(ev.detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
