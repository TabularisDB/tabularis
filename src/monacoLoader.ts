/**
 * Bundles Monaco with the app instead of letting @monaco-editor/react fetch
 * it from the jsDelivr CDN at runtime, so the editor works offline and the
 * shipped version is the one pinned in package.json.
 *
 * Must be evaluated before any `loader.init()` call (some modules call it at
 * import time), hence the side-effect import at the top of main.tsx.
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { installMonacoInputAreaSelectionFix } from "./utils/monacoInputArea";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    // SQL and plaintext only need the base editor worker; JSON is the only
    // language service the app uses (config and MCP editors).
    return label === "json" ? new JsonWorker() : new EditorWorker();
  },
};

loader.config({ monaco });

installMonacoInputAreaSelectionFix();
