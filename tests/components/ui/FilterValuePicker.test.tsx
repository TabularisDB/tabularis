import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FilterValuePicker } from "../../../src/components/ui/FilterValuePicker";
import { VALUE_PICKER_LIMIT } from "../../../src/utils/filterBar";
import type { DistinctValue } from "../../../src/utils/filterBar";

const values: DistinctValue[] = [
  { value: "open", count: 42 },
  { value: "closed", count: 17 },
  { value: "reopened", count: 3 },
];

const setup = (
  props: Partial<React.ComponentProps<typeof FilterValuePicker>> = {},
) => {
  const load = props.load ?? vi.fn().mockResolvedValue(values);
  const onApply = props.onApply ?? vi.fn();
  const onParentKeyDown = vi.fn();
  render(
    <div onKeyDown={onParentKeyDown}>
      <FilterValuePicker
        load={load}
        selected={props.selected ?? []}
        onApply={onApply}
      />
    </div>,
  );
  const open = () =>
    fireEvent.click(
      screen.getByRole("button", { name: "toolbar.valuePicker.open" }),
    );
  return { load, onApply, onParentKeyDown, open };
};

describe("FilterValuePicker", () => {
  it("loads values with their counts when opened, not before", async () => {
    const { load, open } = setup();
    expect(load).not.toHaveBeenCalled();
    const trigger = screen.getByRole("button", {
      name: "toolbar.valuePicker.open",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    open();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("dialog", { name: "toolbar.valuePicker.title" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "toolbar.valuePicker.loading",
    );

    expect(
      await screen.findByRole("checkbox", { name: /^open/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(load).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("searchbox", { name: "toolbar.valuePicker.search" }),
    ).toHaveFocus();
  });

  it("filters the list with the search box", async () => {
    const { open } = setup();
    open();
    await screen.findAllByRole("checkbox");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "OPEN" },
    });
    expect(
      screen
        .getAllByRole("checkbox")
        .map((c) => c.closest("label")?.textContent),
    ).toEqual(["open42", "reopened3"]);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzz" },
    });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText("toolbar.valuePicker.noMatch")).toBeInTheDocument();
  });

  it("applies the ticked values in list order and closes", async () => {
    const { onApply, open } = setup();
    open();
    expect(
      await screen.findByRole("button", {
        name: "toolbar.valuePicker.useNone",
      }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /reopened/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^open/ }));
    const use = screen.getByRole("button", { name: "toolbar.valuePicker.use" });
    expect(use).toBeEnabled();
    fireEvent.click(use);
    expect(onApply).toHaveBeenCalledWith(["open", "reopened"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("applies with Enter from the search box once something is ticked", async () => {
    const { onApply, open } = setup();
    open();
    await screen.findAllByRole("checkbox");
    const search = screen.getByRole("searchbox");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /closed/ }));
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onApply).toHaveBeenCalledWith(["closed"]);
  });

  it("opens with the current values ticked, ignoring ones not in the list", async () => {
    const { onApply, open } = setup({ selected: ["closed", "gone"] });
    open();
    expect(
      await screen.findByRole("checkbox", { name: /closed/ }),
    ).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^open/ })).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: /toolbar.valuePicker.use/ }),
    );
    expect(onApply).toHaveBeenCalledWith(["closed"]);
  });

  it("closes on Escape without applying and without closing the filter panel", async () => {
    const { onApply, onParentKeyDown, open } = setup();
    open();
    await screen.findAllByRole("checkbox");
    fireEvent.click(screen.getByRole("checkbox", { name: /closed/ }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "toolbar.valuePicker.open" }),
    ).toHaveFocus();
  });

  it("closes on Cancel and on an outside click without applying", async () => {
    const { onApply, open } = setup();
    open();
    await screen.findAllByRole("checkbox");
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open();
    await screen.findAllByRole("checkbox");
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("shows the error with a retry that loads again", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce(values);
    const { open } = setup({ load });
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "permission denied",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "toolbar.valuePicker.retry" }),
    );
    expect(await screen.findAllByRole("checkbox")).toHaveLength(3);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("says when the column has no values", async () => {
    const { open } = setup({ load: vi.fn().mockResolvedValue([]) });
    open();
    expect(
      await screen.findByText("toolbar.valuePicker.empty"),
    ).toBeInTheDocument();
  });

  it("notes when only the most frequent values are listed", async () => {
    const many = Array.from({ length: VALUE_PICKER_LIMIT }, (_, i) => ({
      value: `v${i}`,
      count: 1,
    }));
    const { open } = setup({ load: vi.fn().mockResolvedValue(many) });
    open();
    expect(
      await screen.findByText("toolbar.valuePicker.limited"),
    ).toBeInTheDocument();
  });

  it("ignores a load that finishes after the picker was closed", async () => {
    let resolve: (v: DistinctValue[]) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<DistinctValue[]>((r) => {
          resolve = r;
        }),
    );
    const { open } = setup({ load });
    open();
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    resolve(values);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
