/**
 * Binds the locally bundled `monaco-editor` package to `@monaco-editor/react`.
 *
 * Without this, `@monaco-editor/react` fetches Monaco from cdn.jsdelivr.net at
 * runtime. That fails whenever the WebView cannot reach the CDN — offline use,
 * restrictive proxies, and notably the Snap package, where the WebKit network
 * process is denied proxy resolution by the desktop portal — leaving every
 * editor stuck on "Loading...".
 *
 * Monaco's web workers are built by Vite (`?worker`) and served next to the
 * rest of the frontend bundle, so no network access is needed at all.
 *
 * This module runs for its side effects and must be imported before any module
 * that calls `loader.init()`; `main.tsx` imports it first for that reason.
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { createMonacoEnvironment } from "./utils/monacoWorkers";

window.MonacoEnvironment = createMonacoEnvironment({
  editor: EditorWorker,
  json: JsonWorker,
});

loader.config({ monaco });
