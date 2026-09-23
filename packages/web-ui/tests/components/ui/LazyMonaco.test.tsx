import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { EditorProps, DiffEditorProps } from "@monaco-editor/react";
import { MonacoEditor, MonacoDiffEditor } from "../../../src/components/ui/LazyMonaco";

const initialization = vi.hoisted(() => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => { resolve = done; });
  return { pending, resolve };
});
vi.mock("../../../src/utils/monaco", () => ({ ensureMonaco: () => initialization.pending }));
vi.mock("../../../src/components/ui/MonacoEditors", () => ({
  Editor: (props: EditorProps) => <textarea aria-label="editor" defaultValue={props.value} />,
  DiffEditor: (props: DiffEditorProps) => <div aria-label="diff">{props.original}|{props.modified}</div>,
}));

it("waits for offline initialization before mounting either editor and forwards their contents", async () => {
  render(<><MonacoEditor value="SELECT 1" /><MonacoDiffEditor original="before" modified="after" /></>);
  expect(screen.queryByLabelText("editor")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("diff")).not.toBeInTheDocument();
  await act(async () => { initialization.resolve(); await initialization.pending; });
  expect(await screen.findByLabelText("editor")).toHaveValue("SELECT 1");
  expect(await screen.findByLabelText("diff")).toHaveTextContent("before|after");
});
