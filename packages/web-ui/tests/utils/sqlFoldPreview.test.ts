import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { installSqlFoldPreview } from "../../src/utils/sqlFoldPreview";

describe("sqlFoldPreview", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll(".sql-fold-preview").forEach((node) => node.remove());
  });

  it("shows the complete folded query after hovering Monaco's placeholder", async () => {
    vi.useFakeTimers();
    let mouseMove: ((event: Monaco.editor.IEditorMouseEvent) => void) | undefined;
    let mouseLeave: (() => void) | undefined;
    const disposable = (): Monaco.IDisposable => ({ dispose: vi.fn() });
    const editor = {
      getModel: () => ({ getValue: () => "SELECT\n  1;" }),
      onMouseMove: (listener: (event: Monaco.editor.IEditorMouseEvent) => void) => {
        mouseMove = listener;
        return disposable();
      },
      onMouseLeave: (listener: () => void) => {
        mouseLeave = listener;
        return disposable();
      },
      onDidChangeModelContent: () => disposable(),
      onDidScrollChange: () => disposable(),
    } as unknown as Monaco.editor.ICodeEditor;
    const colorize = vi.fn(async (text: string) => `<span>${text}</span>`);
    const monaco = { editor: { colorize } } as unknown as typeof Monaco;
    const placeholder = document.createElement("span");
    placeholder.className = "inline-folded";

    const installation = installSqlFoldPreview(editor, monaco, () => "postgres");
    mouseMove?.({
      event: { posx: 100, posy: 80 },
      target: { element: placeholder, position: { lineNumber: 1, column: 1 } },
    } as unknown as Monaco.editor.IEditorMouseEvent);
    await vi.advanceTimersByTimeAsync(400);

    expect(colorize).toHaveBeenCalledWith("SELECT\n  1", "sql", { tabSize: 2 });
    expect(document.querySelector(".sql-fold-preview-code")).toHaveTextContent(
      "SELECT 1",
    );

    mouseLeave?.();
    const preview = document.querySelector<HTMLElement>(".sql-fold-preview");
    preview?.dispatchEvent(new MouseEvent("mouseenter"));
    await vi.advanceTimersByTimeAsync(150);
    expect(document.querySelector(".sql-fold-preview")).toBe(preview);

    preview?.dispatchEvent(new MouseEvent("mouseleave"));
    expect(document.querySelector(".sql-fold-preview")).toBeNull();
    installation.dispose();
  });

  it("does not preview regular editor text", async () => {
    vi.useFakeTimers();
    let mouseMove: ((event: Monaco.editor.IEditorMouseEvent) => void) | undefined;
    const disposable = (): Monaco.IDisposable => ({ dispose: vi.fn() });
    const editor = {
      getModel: () => ({ getValue: () => "SELECT\n  1;" }),
      onMouseMove: (listener: (event: Monaco.editor.IEditorMouseEvent) => void) => {
        mouseMove = listener;
        return disposable();
      },
      onMouseLeave: () => disposable(),
      onDidChangeModelContent: () => disposable(),
      onDidScrollChange: () => disposable(),
    } as unknown as Monaco.editor.ICodeEditor;
    const colorize = vi.fn(async () => "");
    const monaco = { editor: { colorize } } as unknown as typeof Monaco;
    const text = document.createElement("span");

    const installation = installSqlFoldPreview(editor, monaco, () => "postgres");
    mouseMove?.({
      event: { posx: 100, posy: 80 },
      target: { element: text, position: { lineNumber: 1, column: 1 } },
    } as unknown as Monaco.editor.IEditorMouseEvent);
    await vi.advanceTimersByTimeAsync(400);

    expect(colorize).not.toHaveBeenCalled();
    expect(document.querySelector(".sql-fold-preview")).toBeNull();
    installation.dispose();
  });
});
