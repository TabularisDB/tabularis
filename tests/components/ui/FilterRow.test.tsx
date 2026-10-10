import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterRow } from "../../../src/components/ui/FilterRow";
import type { StructuredFilter } from "../../../src/utils/filterBar";
import type { TableColumn } from "../../../src/types/editor";

const col = (name: string, data_type: string): TableColumn => ({
  name,
  data_type,
  is_pk: false,
  is_nullable: true,
  is_auto_increment: false,
});
const columns = [
  col("status", "varchar(20)"),
  col("payload", "jsonb"),
  col("qty", "integer"),
];

const renderRow = (
  filter: StructuredFilter,
  extra: Partial<React.ComponentProps<typeof FilterRow>> = {},
) => {
  const onChange = vi.fn();
  render(
    <FilterRow
      filter={filter}
      columns={columns}
      onChange={onChange}
      onRemove={vi.fn()}
      onApplySingle={vi.fn()}
      onDuplicate={vi.fn()}
      onEscape={vi.fn()}
      isApplied={false}
      onTriggerApplied={vi.fn()}
      {...extra}
    />,
  );
  return { onChange };
};

const pickerButton = () =>
  screen.queryByRole("button", { name: "toolbar.valuePicker.open" });

describe("FilterRow value picker", () => {
  const base: StructuredFilter = {
    id: "f1",
    column: "status",
    operator: "=",
    value: "",
  };

  it("is offered next to the value field when values can be loaded", () => {
    renderRow(base, { onLoadValues: vi.fn() });
    expect(pickerButton()).toBeInTheDocument();
  });

  it("is not offered without a loader (e.g. query results that are not a table)", () => {
    renderRow(base);
    expect(pickerButton()).not.toBeInTheDocument();
  });

  it("is not offered for JSON / BLOB columns", () => {
    renderRow({ ...base, column: "payload" }, { onLoadValues: vi.fn() });
    expect(pickerButton()).not.toBeInTheDocument();
  });

  it("is not offered for operators without a single value field", () => {
    renderRow({ ...base, operator: "IS NULL" }, { onLoadValues: vi.fn() });
    expect(pickerButton()).not.toBeInTheDocument();
    renderRow(
      { ...base, column: "qty", operator: "BETWEEN" },
      { onLoadValues: vi.fn() },
    );
    expect(pickerButton()).not.toBeInTheDocument();
  });

  it("loads values for this row and turns several picks into IN", async () => {
    const onLoadValues = vi.fn().mockResolvedValue([
      { value: "open", count: 5 },
      { value: "Paris, TX", count: 2 },
    ]);
    const { onChange } = renderRow(base, { onLoadValues });
    fireEvent.click(pickerButton()!);
    expect(onLoadValues).toHaveBeenCalledWith(base);
    fireEvent.click(await screen.findByRole("checkbox", { name: /^open/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Paris/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /toolbar.valuePicker.use/ }),
    );
    expect(onChange).toHaveBeenCalledWith({
      ...base,
      operator: "IN",
      value: "open, 'Paris, TX'",
    });
  });

  it("turns a single pick into =", async () => {
    const onLoadValues = vi
      .fn()
      .mockResolvedValue([{ value: "007", count: 1 }]);
    const { onChange } = renderRow(
      { ...base, operator: "LIKE", value: "0%" },
      { onLoadValues },
    );
    fireEvent.click(pickerButton()!);
    fireEvent.click(await screen.findByRole("checkbox", { name: /007/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /toolbar.valuePicker.use/ }),
    );
    expect(onChange).toHaveBeenCalledWith({
      ...base,
      operator: "=",
      value: "'007'",
    });
  });
});
