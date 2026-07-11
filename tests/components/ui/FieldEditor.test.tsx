import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { FieldEditor } from "../../../src/components/ui/FieldEditor";

// Mock GeometryInput component
interface MockGeometryInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

vi.mock("../../../src/components/ui/GeometryInput", () => ({
  GeometryInput: ({ value, onChange, placeholder }: MockGeometryInputProps) => (
    <input
      data-testid="geometry-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

// Mock geometry utilities
vi.mock("../../../src/utils/geometry", () => ({
  isGeometricType: (type: string) => type === "geometry" || type === "point",
  formatGeometricValue: (value: unknown) => {
    // Simple mock: if it looks like WKB hex, convert to fake WKT
    const str = String(value);
    if (str.startsWith("0x") || str.startsWith("\\x")) {
      return "POINT(0 0)"; // Mock WKT output
    }
    return str;
  },
}));

describe("FieldEditor", () => {
  it("should render textarea for non-geometric types", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="name"
        type="varchar"
        value="John Doe"
        onChange={onChange}
      />
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveValue("John Doe");
  });

  it("should render GeometryInput for geometric types", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="location"
        type="geometry"
        value="POINT(0 0)"
        onChange={onChange}
      />
    );

    const geometryInput = screen.getByTestId("geometry-input");
    expect(geometryInput).toBeInTheDocument();
    expect(geometryInput).toHaveValue("POINT(0 0)");
  });

  it("should call onChange when textarea value changes", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="name"
        type="varchar"
        value="John"
        onChange={onChange}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Jane" } });

    expect(onChange).toHaveBeenCalledWith("Jane");
  });

  it("should handle null values gracefully", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="name"
        type="varchar"
        value={null}
        onChange={onChange}
      />
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveValue("");
  });

  it("should display custom placeholder", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="name"
        type="varchar"
        value=""
        onChange={onChange}
        placeholder="Custom placeholder"
      />
    );

    const textarea = screen.getByPlaceholderText("Custom placeholder");
    expect(textarea).toBeInTheDocument();
  });

  it("should apply custom className", () => {
    const onChange = vi.fn();
    const { container } = render(
      <FieldEditor
        name="name"
        type="varchar"
        value=""
        onChange={onChange}
        className="custom-class"
      />
    );

    const textarea = container.querySelector("textarea");
    expect(textarea?.className).toContain("custom-class");
  });

  it("should show quick action buttons when field supports special values", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="id"
        type="integer"
        value=""
        onChange={onChange}
        isInsertion={true}
        isAutoIncrement={true}
        hasDefault={false}
        isNullable={true}
      />
    );

    expect(screen.getByTitle("dataGrid.setGenerate")).toBeInTheDocument();
    expect(screen.getByTitle("dataGrid.setNull")).toBeInTheDocument();
    // "Set Empty" is not offered for non-textual columns (an empty string is
    // not a valid value for an integer column).
    expect(screen.queryByTitle("dataGrid.setEmpty")).not.toBeInTheDocument();
  });

  it("should call onChange with null when SET GENERATED is clicked", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="id"
        type="integer"
        value=""
        onChange={onChange}
        isInsertion={true}
        isAutoIncrement={true}
      />
    );

    const generateBtn = screen.getByTitle("dataGrid.setGenerate");
    fireEvent.click(generateBtn);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("should call onChange with null when SET NULL is clicked", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="description"
        type="varchar"
        value=""
        onChange={onChange}
        isNullable={true}
      />
    );

    const nullBtn = screen.getByTitle("dataGrid.setNull");
    fireEvent.click(nullBtn);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("should call onChange with sentinel when SET DEFAULT is clicked on existing row", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="status"
        type="varchar"
        value=""
        onChange={onChange}
        isInsertion={false}
        hasDefault={true}
      />
    );

    const defaultBtn = screen.getByTitle("dataGrid.setDefault");
    fireEvent.click(defaultBtn);

    expect(onChange).toHaveBeenCalledWith("__USE_DEFAULT__");
  });

  it("should call onChange with null when SET DEFAULT is clicked on insertion row", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="status"
        type="varchar"
        value=""
        onChange={onChange}
        isInsertion={true}
        hasDefault={true}
      />
    );

    const defaultBtn = screen.getByTitle("dataGrid.setDefault");
    fireEvent.click(defaultBtn);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("should call onChange with an empty string when SET EMPTY is clicked", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="name"
        type="varchar"
        value=""
        onChange={onChange}
        hasDefault={true}
      />
    );

    const emptyBtn = screen.getByTitle("dataGrid.setEmpty");
    fireEvent.click(emptyBtn);

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("should not show SET EMPTY for a non-textual (uuid) column", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="categoryId"
        type="uuid"
        value=""
        onChange={onChange}
        isNullable={true}
      />
    );

    // The uuid column is nullable, so the SET NULL action is still offered…
    expect(screen.getByTitle("dataGrid.setNull")).toBeInTheDocument();
    // …but SET EMPTY must not be, since Postgres rejects '' for a uuid column.
    expect(screen.queryByTitle("dataGrid.setEmpty")).not.toBeInTheDocument();
  });

  it("should not show SET GENERATED button for non-insertion rows", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="id"
        type="integer"
        value=""
        onChange={onChange}
        isInsertion={false}
        isAutoIncrement={true}
      />
    );

    expect(screen.queryByTitle("dataGrid.setGenerate")).not.toBeInTheDocument();
  });

  it("should not show quick actions when field has no special properties", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="name"
        type="varchar"
        value=""
        onChange={onChange}
        isInsertion={false}
        isAutoIncrement={false}
        hasDefault={false}
        isNullable={false}
      />
    );

    expect(screen.queryByTitle("dataGrid.setGenerate")).not.toBeInTheDocument();
    expect(screen.queryByTitle("dataGrid.setNull")).not.toBeInTheDocument();
    expect(screen.queryByTitle("dataGrid.setDefault")).not.toBeInTheDocument();
  });

  it("should format geometric values for display (WKB to WKT)", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="location"
        type="geometry"
        value="0x0101000000000000000000F03F0000000000000040"
        onChange={onChange}
      />
    );

    // The GeometryInput should receive the formatted WKT value
    const geometryInput = screen.getByTestId("geometry-input");
    expect(geometryInput).toHaveValue("POINT(0 0)");
  });

  it("should handle empty/null geometric values without formatting", () => {
    const onChange = vi.fn();
    render(
      <FieldEditor
        name="location"
        type="geometry"
        value={null}
        onChange={onChange}
      />
    );

    const geometryInput = screen.getByTestId("geometry-input");
    expect(geometryInput).toHaveValue("");
  });
});
