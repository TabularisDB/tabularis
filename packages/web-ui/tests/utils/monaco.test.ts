import { describe, expect, it, vi } from "vitest";
import { loader } from "@monaco-editor/react";
import { ensureMonaco } from "../../src/utils/monaco";

vi.mock("monaco-editor", () => ({ editor: { colorize: vi.fn() }, languages: {} }));
vi.mock("@monaco-editor/react", () => ({ loader: { config: vi.fn() } }));
vi.mock("../../src/utils/monacoInputArea", () => ({ installMonacoInputAreaSelectionFix: vi.fn() }));
vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({ default: class EditorWorker {} }));
vi.mock("monaco-editor/esm/vs/language/json/json.worker?worker", () => ({ default: class JsonWorker {} }));

describe("ensureMonaco", () => {
  it("configures the bundled offline editor and workers once, before releasing concurrent callers", async () => {
    expect(loader.config).not.toHaveBeenCalled();
    const first = ensureMonaco();
    const second = ensureMonaco();
    expect(second).toBe(first);
    const monaco = await first;
    expect(loader.config).toHaveBeenCalledExactlyOnceWith({ monaco });
    expect(self.MonacoEnvironment?.getWorker).toBeTypeOf("function");
    await ensureMonaco();
    expect(loader.config).toHaveBeenCalledTimes(1);
  });
});
