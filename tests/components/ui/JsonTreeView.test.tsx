import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { JsonEditorProps } from "json-edit-react";

type CapturedProps = JsonEditorProps & {
  restrictEdit?: boolean;
  restrictAdd?: boolean;
  restrictDelete?: boolean;
  restrictTypeSelection?: boolean;
};

const lastProps: { current: CapturedProps | null } = { current: null };

vi.mock("json-edit-react", () => ({
  JsonEditor: (props: CapturedProps) => {
    lastProps.current = props;
    return (
      <div data-testid="mock-json-editor">
        {JSON.stringify(props.data)}
      </div>
    );
  },
  defaultTheme: { displayName: "default", styles: {} },
  githubDarkTheme: { displayName: "githubDark", styles: {} },
  githubLightTheme: { displayName: "githubLight", styles: {} },
}));

// eslint-disable-next-line import/first
import { JsonTreeView } from "../../../src/components/ui/JsonTreeView";

describe("JsonTreeView", () => {
  beforeEach(() => {
    lastProps.current = null;
  });

  it("renders nested data through the underlying JSON editor", () => {
    const data = { name: "Alice", nested: { count: 3 } };
    render(<JsonTreeView value={data} onChange={() => {}} />);

    expect(screen.getByTestId("mock-json-editor")).toBeInTheDocument();
    expect(lastProps.current).not.toBeNull();
    expect(lastProps.current!.data).toEqual(data);
  });

  it("allows leaf edits but restricts structural mutations when onChange is provided", () => {
    render(<JsonTreeView value={{ a: 1 }} onChange={() => {}} />);

    expect(lastProps.current!.restrictEdit).toBe(false);
    expect(lastProps.current!.restrictAdd).toBe(true);
    expect(lastProps.current!.restrictDelete).toBe(true);
    expect(lastProps.current!.restrictTypeSelection).toBe(true);
  });

  it("is view-only when readOnly is true", () => {
    render(
      <JsonTreeView value={{ a: 1 }} onChange={() => {}} readOnly />,
    );

    expect(lastProps.current!.restrictEdit).toBe(true);
    expect(lastProps.current!.restrictAdd).toBe(true);
    expect(lastProps.current!.restrictDelete).toBe(true);
    expect(lastProps.current!.restrictTypeSelection).toBe(true);
  });

  it("is view-only when onChange is omitted", () => {
    render(<JsonTreeView value={{ a: 1 }} />);

    expect(lastProps.current!.restrictEdit).toBe(true);
    expect(lastProps.current!.restrictAdd).toBe(true);
    expect(lastProps.current!.restrictDelete).toBe(true);
    expect(lastProps.current!.restrictTypeSelection).toBe(true);
  });

  it("emits onChange when the underlying editor reports updated data", () => {
    const onChange = vi.fn();
    render(<JsonTreeView value={{ a: 1 }} onChange={onChange} />);

    const setData = lastProps.current!.setData;
    expect(setData).toBeTypeOf("function");
    setData!({ a: 2 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ a: 2 });
  });

  it("does not provide setData when in read-only mode", () => {
    render(<JsonTreeView value={{ a: 1 }} readOnly onChange={() => {}} />);
    expect(lastProps.current!.setData).toBeUndefined();
  });

  it("forwards searchQuery to the editor's searchText prop", () => {
    render(<JsonTreeView value={{ a: 1 }} searchQuery="needle" />);
    expect(lastProps.current!.searchText).toBe("needle");
  });

  it("wires onCopy through the editor's enableClipboard callback", () => {
    const onCopy = vi.fn();
    render(<JsonTreeView value={{ a: 1 }} onCopy={onCopy} />);

    const clipboard = lastProps.current!.enableClipboard;
    expect(typeof clipboard).toBe("function");

    if (typeof clipboard === "function") {
      clipboard({
        success: true,
        errorMessage: null,
        key: "a",
        path: ["a"],
        value: 1,
        stringValue: "1",
        type: "value",
      });
    }

    expect(onCopy).toHaveBeenCalledWith("1");
  });

  it("provides a theme object to the underlying editor", () => {
    render(<JsonTreeView value={{ a: 1 }} />);
    expect(lastProps.current!.theme).toBeDefined();
  });

  describe("leaf editing", () => {
    it("emits onChange with updated root when a string leaf is edited", () => {
      const onChange = vi.fn();
      render(
        <JsonTreeView
          value={{ name: "Alice", age: 30 }}
          onChange={onChange}
        />,
      );

      lastProps.current!.setData!({ name: "Bob", age: 30 });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ name: "Bob", age: 30 });
    });

    it("emits onChange with updated root when a numeric leaf is edited", () => {
      const onChange = vi.fn();
      render(<JsonTreeView value={{ count: 1 }} onChange={onChange} />);

      lastProps.current!.setData!({ count: 42 });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ count: 42 });
    });

    it("emits onChange with updated root when a boolean leaf is toggled", () => {
      const onChange = vi.fn();
      render(
        <JsonTreeView value={{ active: false }} onChange={onChange} />,
      );

      lastProps.current!.setData!({ active: true });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ active: true });
    });

    it("disallows adding new keys via restrictAdd and restrictTypeSelection", () => {
      render(<JsonTreeView value={{ a: 1 }} onChange={() => {}} />);

      expect(lastProps.current!.restrictAdd).toBe(true);
      expect(lastProps.current!.restrictTypeSelection).toBe(true);
    });

    it("does not call onChange when no onChange prop is provided", () => {
      render(<JsonTreeView value={{ a: 1 }} />);

      expect(lastProps.current!.setData).toBeUndefined();
    });
  });

  describe("search", () => {
    it("renders a controlled search input when no external searchQuery is provided", () => {
      render(<JsonTreeView value={{ a: 1 }} />);
      const input = screen.getByPlaceholderText("jsonInput.search");
      expect(input).toBeInTheDocument();
      expect((input as HTMLInputElement).value).toBe("");
    });

    it("does not render the internal search input when searchQuery is provided", () => {
      render(<JsonTreeView value={{ a: 1 }} searchQuery="" />);
      expect(
        screen.queryByPlaceholderText("jsonInput.search"),
      ).not.toBeInTheDocument();
    });

    it("forwards typed text from the internal input to the editor's searchText", () => {
      render(<JsonTreeView value={{ name: "Alice", nested: { count: 3 } }} />);
      const input = screen.getByPlaceholderText(
        "jsonInput.search",
      ) as HTMLInputElement;

      fireEvent.change(input, { target: { value: "Alice" } });
      expect(input.value).toBe("Alice");
      expect(lastProps.current!.searchText).toBe("Alice");
    });

    it("clears the editor's searchText when the internal input is cleared", () => {
      render(<JsonTreeView value={{ name: "Alice" }} />);
      const input = screen.getByPlaceholderText(
        "jsonInput.search",
      ) as HTMLInputElement;

      fireEvent.change(input, { target: { value: "Alice" } });
      expect(lastProps.current!.searchText).toBe("Alice");

      fireEvent.change(input, { target: { value: "" } });
      expect(input.value).toBe("");
      expect(lastProps.current!.searchText).toBe("");
    });

    it("forwards the user's text verbatim so the library can do case-insensitive matching", () => {
      render(<JsonTreeView value={{ Name: "Alice" }} />);
      const input = screen.getByPlaceholderText(
        "jsonInput.search",
      ) as HTMLInputElement;

      fireEvent.change(input, { target: { value: "alice" } });
      expect(lastProps.current!.searchText).toBe("alice");

      fireEvent.change(input, { target: { value: "ALICE" } });
      expect(lastProps.current!.searchText).toBe("ALICE");
    });

    it("configures searchFilter to match both keys and values", () => {
      render(<JsonTreeView value={{ a: 1 }} />);
      expect(lastProps.current!.searchFilter).toBe("all");
    });

    it("prefers the external searchQuery over the internal input state", () => {
      const { rerender } = render(
        <JsonTreeView value={{ a: 1 }} searchQuery="external" />,
      );
      expect(lastProps.current!.searchText).toBe("external");

      rerender(<JsonTreeView value={{ a: 1 }} searchQuery="updated" />);
      expect(lastProps.current!.searchText).toBe("updated");
    });
  });
});
