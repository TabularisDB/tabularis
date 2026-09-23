import type * as Monaco from "monaco-editor";

let pending: Promise<typeof Monaco> | undefined;

/** One local, offline-capable initialization shared by editors and previews. */
export function ensureMonaco(): Promise<typeof Monaco> {
  pending ??= import("../monacoLoader").then((module) => module.monaco).catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
