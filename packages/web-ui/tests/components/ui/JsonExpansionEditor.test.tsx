import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JsonExpansionEditor } from "../../../src/components/ui/JsonExpansionEditor";

vi.mock("../../../src/components/ui/CellCodeEditor", () => ({
  CellCodeEditor: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange: (next: string) => void;
    readOnly?: boolean;
  }) => (
    <textarea
      data-testid="json-code-editor"
      readOnly={readOnly}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

describe("JsonExpansionEditor", () => {
  const baseProps = {
    value: { a: 1 },
    readOnly: false,
    onSave: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders save and cancel buttons when editable", () => {
    render(<JsonExpansionEditor {...baseProps} />);
    expect(screen.getByText("common.cancel")).toBeInTheDocument();
    expect(screen.getByText("jsonViewer.save")).toBeInTheDocument();
  });

  it("hides buttons when read-only", () => {
    render(<JsonExpansionEditor {...baseProps} readOnly={true} />);
    expect(screen.queryByText("common.cancel")).toBeNull();
    expect(screen.queryByText("jsonViewer.save")).toBeNull();
  });

  it("disables save while no edits", () => {
    render(<JsonExpansionEditor {...baseProps} />);
    const save = screen.getByText("jsonViewer.save");
    expect(save).toBeDisabled();
  });

  it("calls onCancel when cancel clicked", () => {
    const onCancel = vi.fn();
    render(<JsonExpansionEditor {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("common.cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onSave with parsed value when save clicked", () => {
    const onSave = vi.fn();
    render(<JsonExpansionEditor {...baseProps} onSave={onSave} />);
    const editor = screen.getByTestId("json-code-editor");
    fireEvent.change(editor, { target: { value: '{"a":2}' } });
    fireEvent.click(screen.getByText("jsonViewer.save"));
    expect(onSave).toHaveBeenCalledWith({ a: 2 });
  });

  it("disables save and shows error on invalid JSON", () => {
    render(<JsonExpansionEditor {...baseProps} />);
    const editor = screen.getByTestId("json-code-editor");
    fireEvent.change(editor, { target: { value: "{ broken" } });
    expect(screen.getByTestId("json-expansion-error")).toBeInTheDocument();
    expect(screen.getByText("jsonViewer.save")).toBeDisabled();
  });

  it("formats incoming object as pretty-printed JSON", () => {
    render(<JsonExpansionEditor {...baseProps} value={{ a: { b: 1 } }} />);
    const editor = screen.getByTestId("json-code-editor") as HTMLTextAreaElement;
    expect(editor.value).toBe('{\n  "a": {\n    "b": 1\n  }\n}');
  });

  it("parses incoming string JSON before display", () => {
    render(<JsonExpansionEditor {...baseProps} value={'{"a":1}'} />);
    const editor = screen.getByTestId("json-code-editor") as HTMLTextAreaElement;
    expect(editor.value).toBe('{\n  "a": 1\n}');
  });
});
