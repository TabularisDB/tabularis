import type * as Monaco from "monaco-editor";

/** A worker bundle as produced by Vite's `?worker` import suffix. */
export type MonacoWorkerConstructor = new () => Worker;

/**
 * Worker bundles available to Monaco, keyed by the language-service label
 * Monaco passes to `MonacoEnvironment.getWorker`.
 *
 * Tabularis only edits SQL, JSON and plain text, so the generic editor worker
 * (tokenization, diffing, word-based suggestions) and the JSON language
 * service are the only workers that need to ship with the app.
 */
export interface MonacoWorkerConstructors {
  editor: MonacoWorkerConstructor;
  json: MonacoWorkerConstructor;
}

/**
 * Picks the worker bundle for a Monaco language-service label.
 *
 * Unknown labels fall back to the generic editor worker, which keeps the
 * editor functional (highlighting, folding, basic completion) for languages
 * without a dedicated language service.
 */
export function selectMonacoWorker(
  label: string,
  workers: MonacoWorkerConstructors,
): MonacoWorkerConstructor {
  return label === "json" ? workers.json : workers.editor;
}

/**
 * Builds the `MonacoEnvironment` that makes Monaco spawn its web workers from
 * bundles served with the app instead of a remote CDN.
 */
export function createMonacoEnvironment(
  workers: MonacoWorkerConstructors,
): Monaco.Environment {
  return {
    getWorker: (_workerId: string, label: string): Worker =>
      new (selectMonacoWorker(label, workers))(),
  };
}
