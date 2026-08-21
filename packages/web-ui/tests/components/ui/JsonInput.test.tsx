import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

interface CodeEditorMockProps {
  value: string;
  onChange: (next: string) => void;
  height?: string | number;
  readOnly?: boolean;
}

interface TreeViewMockProps {
  value: unknown;
  onChange?: (next: unknown) => void;
  readOnly?: boolean;
}

const codeProps: { current: CodeEditorMockProps | null } = { current: null };
const treeProps: { current: TreeViewMockProps | null } = { current: null };

vi.mock("../../../src/components/ui/CellCodeEditor", () => ({
  CellCodeEditor: (props: CodeEditorMockProps) => {
    codeProps.current = props;
    return (
      <textarea
        data-testid="mock-code-editor"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    );
  },
}));

vi.mock("../../../src/components/ui/JsonTreeView", () => ({
  JsonTreeView: (props: TreeViewMockProps) => {
    treeProps.current = props;
    return (
      <div data-testid="mock-tree-view">
        {JSON.stringify(props.value)}
      </div>
    );
  },
}));

// eslint-disable-next-line import/first
import { JsonInput } from "../../../src/components/ui/JsonInput";

const getTab = (mode: "code" | "tree" | "raw") =>
  document.querySelector(`[data-mode="${mode}"]`) as HTMLButtonElement;

describe("JsonInput", () => {
  beforeEach(() => {
    codeProps.current = null;
    treeProps.current = null;
  });

  it("renders Code mode by default", () => {
    render(<JsonInput value={{ a: 1 }} onChange={vi.fn()} />);

    expect(screen.getByTestId("json-input-code")).toBeInTheDocument();
    expect(screen.queryByTestId("json-input-tree")).not.toBeInTheDocument();
    expect(screen.queryByTestId("json-input-raw")).not.toBeInTheDocument();
    expect(getTab("code").getAttribute("aria-selected")).toBe("true");
  });

  it("seeds the editor with a pretty-printed copy of the value", () => {
    render(<JsonInput value={{ a: 1, b: 2 }} onChange={vi.fn()} />);

    expect(codeProps.current?.value).toBe(JSON.stringify({ a: 1, b: 2 }, null, 2));
  });

  it("switches to Tree mode when the tab is clicked", () => {
    render(<JsonInput value={{ a: 1 }} onChange={vi.fn()} />);

    fireEvent.click(getTab("tree"));

    expect(screen.getByTestId("json-input-tree")).toBeInTheDocument();
    expect(screen.queryByTestId("json-input-code")).not.toBeInTheDocument();
    expect(getTab("tree").getAttribute("aria-selected")).toBe("true");
    expect(treeProps.current?.value).toEqual({ a: 1 });
  });

  it("switches to Raw mode when the tab is clicked", () => {
    render(<JsonInput value={{ a: 1 }} onChange={vi.fn()} />);

    fireEvent.click(getTab("raw"));

    const raw = screen.getByTestId("json-input-raw") as HTMLTextAreaElement;
    expect(raw).toBeInTheDocument();
    expect(raw.value).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(getTab("raw").getAttribute("aria-selected")).toBe("true");
  });

  it("emits parsed values when Code mode edits produce valid JSON", () => {
    const onChange = vi.fn();
    render(<JsonInput value={{ a: 1 }} onChange={onChange} />);

    fireEvent.change(screen.getByTestId("mock-code-editor"), {
      target: { value: '{"a":2}' },
    });

    expect(onChange).toHaveBeenLastCalledWith({ a: 2 });
  });

  it("does not emit while Code mode contains invalid JSON, then shows the invalid indicator", () => {
    const onChange = vi.fn();
    render(<JsonInput value={{ a: 1 }} onChange={onChange} />);

    fireEvent.change(screen.getByTestId("mock-code-editor"), {
      target: { value: "{bad" },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("jsonInput.invalid")).toBeInTheDocument();
  });

  it("emits parsed values when Raw mode edits produce valid JSON", () => {
    const onChange = vi.fn();
    render(<JsonInput value={{ a: 1 }} onChange={onChange} />);

    fireEvent.click(getTab("raw"));

    fireEvent.change(screen.getByTestId("json-input-raw"), {
      target: { value: '{"a":3}' },
    });

    expect(onChange).toHaveBeenLastCalledWith({ a: 3 });
    expect(screen.getByText("jsonInput.valid")).toBeInTheDocument();
  });

  it("emits raw values from Tree mode edits", () => {
    const onChange = vi.fn();
    render(<JsonInput value={{ a: 1 }} onChange={onChange} />);

    fireEvent.click(getTab("tree"));
    treeProps.current?.onChange?.({ a: 99 });

    expect(onChange).toHaveBeenCalledWith({ a: 99 });
  });

  it("hides the Format button and validation indicator in Tree mode", () => {
    render(<JsonInput value={{ a: 1 }} onChange={vi.fn()} />);

    fireEvent.click(getTab("tree"));

    expect(screen.queryByTitle("jsonInput.format")).not.toBeInTheDocument();
    expect(screen.queryByText("jsonInput.valid")).not.toBeInTheDocument();
    expect(screen.queryByText("jsonInput.invalid")).not.toBeInTheDocument();
  });

  it("Format button pretty-prints minified JSON in Raw mode", () => {
    const onChange = vi.fn();
    render(<JsonInput value={null} onChange={onChange} />);

    fireEvent.click(getTab("raw"));

    const raw = screen.getByTestId("json-input-raw") as HTMLTextAreaElement;
    fireEvent.change(raw, { target: { value: '{"a":1,"b":2}' } });

    fireEvent.click(screen.getByTitle("jsonInput.format"));

    expect(raw.value).toBe('{\n  "a": 1,\n  "b": 2\n}');
    expect(onChange).toHaveBeenLastCalledWith({ a: 1, b: 2 });
  });

  it("propagates external value changes into the active editor", () => {
    const { rerender } = render(
      <JsonInput value={{ a: 1 }} onChange={vi.fn()} />,
    );

    expect(codeProps.current?.value).toBe(
      JSON.stringify({ a: 1 }, null, 2),
    );

    rerender(<JsonInput value={{ a: 5 }} onChange={vi.fn()} />);

    expect(codeProps.current?.value).toBe(
      JSON.stringify({ a: 5 }, null, 2),
    );
  });

  it("passes null to Tree mode when the text is invalid JSON", () => {
    render(<JsonInput value={{ a: 1 }} onChange={vi.fn()} />);

    fireEvent.change(screen.getByTestId("mock-code-editor"), {
      target: { value: "not json" },
    });
    fireEvent.click(getTab("tree"));

    expect(treeProps.current?.value).toBeNull();
  });

  describe("readOnly mode", () => {
    it("forwards readOnly to CellCodeEditor in code mode", () => {
      render(<JsonInput value={{ a: 1 }} onChange={vi.fn()} readOnly />);

      expect(codeProps.current?.readOnly).toBe(true);
    });

    it("forwards readOnly to JsonTreeView in tree mode", () => {
      render(<JsonInput value={{ a: 1 }} onChange={vi.fn()} readOnly />);

      fireEvent.click(getTab("tree"));

      expect(treeProps.current?.readOnly).toBe(true);
    });

    it("marks the raw textarea as readOnly", () => {
      render(<JsonInput value={{ a: 1 }} onChange={vi.fn()} readOnly />);

      fireEvent.click(getTab("raw"));

      const raw = screen.getByTestId("json-input-raw") as HTMLTextAreaElement;
      expect(raw.readOnly).toBe(true);
    });

    it("hides the Format button when readOnly", () => {
      render(<JsonInput value={{ a: 1 }} onChange={vi.fn()} readOnly />);

      expect(screen.queryByTitle("jsonInput.format")).not.toBeInTheDocument();
    });
  });
});
