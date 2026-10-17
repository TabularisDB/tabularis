import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ColumnStatsPopover } from "../../../src/components/ui/ColumnStatsPopover";
import type {
  ColumnStats,
  ColumnStatsSupport,
} from "../../../src/utils/columnStats";

const ALL: ColumnStatsSupport = { distinct: true, minMax: true, topValues: true };

const stats: ColumnStats = {
  rowCount: 10,
  nullCount: 2,
  distinctCount: 3,
  min: 1,
  max: 250,
  topValues: [
    { value: "7", count: 5 },
    { value: "", count: 2 },
    { value: "250", count: 1 },
  ],
  filtered: false,
};

const setup = (
  props: Partial<React.ComponentProps<typeof ColumnStatsPopover>> = {},
) => {
  const load = props.load ?? vi.fn().mockResolvedValue(stats);
  const onClose = props.onClose ?? vi.fn();
  const onFilterByValue =
    "onFilterByValue" in props ? props.onFilterByValue : vi.fn();
  const onParentKeyDown = vi.fn();
  render(
    <div onKeyDown={onParentKeyDown}>
      <ColumnStatsPopover
        x={20}
        y={20}
        column="amount"
        support={props.support ?? ALL}
        masked={props.masked}
        load={load}
        onFilterByValue={onFilterByValue}
        onClose={onClose}
      />
    </div>,
  );
  return { load, onClose, onFilterByValue, onParentKeyDown };
};

describe("ColumnStatsPopover", () => {
  it("shows a loading state, then the counts, min / max and top values", async () => {
    let resolve: (value: ColumnStats) => void = () => {};
    const load = vi.fn(
      () => new Promise<ColumnStats>((r) => { resolve = r; }),
    );
    setup({ load });

    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "dataGrid.columnStats.title",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "dataGrid.columnStats.loading",
    );

    resolve(stats);

    expect(await screen.findByText("dataGrid.columnStats.rows")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    // 2 of 10 rows are NULL.
    expect(screen.getByText("(20%)")).toBeInTheDocument();
    expect(screen.getByText("dataGrid.columnStats.min").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("dataGrid.columnStats.max").nextSibling).toHaveTextContent("250");
    expect(screen.getAllByTitle("dataGrid.columnStats.filterBy")).toHaveLength(3);
    expect(screen.getByText("dataGrid.columnStats.clickToFilter")).toBeInTheDocument();
    expect(screen.queryByText("dataGrid.columnStats.filtered")).toBeNull();
  });

  it("filters the table by a top value and closes", async () => {
    const { onFilterByValue, onClose } = setup();
    const buttons = await screen.findAllByTitle("dataGrid.columnStats.filterBy");
    fireEvent.click(buttons[1]);
    expect(onFilterByValue).toHaveBeenCalledWith("");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows read-only top values without a filter handler", async () => {
    setup({ onFilterByValue: undefined });
    expect(await screen.findByText("7")).toBeInTheDocument();
    expect(screen.queryByTitle("dataGrid.columnStats.filterBy")).toBeNull();
    expect(screen.queryByText("dataGrid.columnStats.clickToFilter")).toBeNull();
  });

  it("marks a column whose non-NULL values are all distinct and notes the filter", async () => {
    setup({
      load: vi.fn().mockResolvedValue({
        ...stats,
        distinctCount: 8,
        filtered: true,
      }),
    });
    expect(await screen.findByText("dataGrid.columnStats.unique")).toBeInTheDocument();
    expect(screen.getByText("dataGrid.columnStats.filtered")).toBeInTheDocument();
  });

  it("hides min / max and explains missing top values for unsupported types", async () => {
    setup({
      support: { distinct: false, minMax: false, topValues: false },
      load: vi.fn().mockResolvedValue({
        rowCount: 4,
        nullCount: 1,
        distinctCount: null,
        min: null,
        max: null,
        topValues: null,
        filtered: false,
      }),
    });
    expect(
      await screen.findByText("dataGrid.columnStats.unsupportedNote"),
    ).toBeInTheDocument();
    expect(screen.queryByText("dataGrid.columnStats.min")).toBeNull();
    expect(screen.queryByText("dataGrid.columnStats.distinct")).toBeNull();
  });

  it("explains that a masked column's values are hidden", async () => {
    setup({
      masked: true,
      support: { distinct: true, minMax: false, topValues: false },
      load: vi.fn().mockResolvedValue({ ...stats, min: null, max: null, topValues: null }),
    });
    expect(await screen.findByText("dataGrid.columnStats.maskedNote")).toBeInTheDocument();
  });

  it("handles NULL-only and empty columns", async () => {
    setup({
      load: vi.fn().mockResolvedValue({
        rowCount: 3,
        nullCount: 3,
        distinctCount: 0,
        min: null,
        max: null,
        topValues: [],
        filtered: false,
      }),
    });
    expect(await screen.findByText("dataGrid.columnStats.onlyNulls")).toBeInTheDocument();
    expect(screen.getAllByText("NULL")).toHaveLength(2);
  });

  it("says there are no rows for an empty result", async () => {
    setup({
      load: vi.fn().mockResolvedValue({
        rowCount: 0,
        nullCount: 0,
        distinctCount: 0,
        min: null,
        max: null,
        topValues: [],
        filtered: true,
      }),
    });
    expect(await screen.findByText("dataGrid.columnStats.noRows")).toBeInTheDocument();
  });

  it("aborts the load when cancelled while loading", () => {
    let signal: AbortSignal | undefined;
    const load = vi.fn((s: AbortSignal) => {
      signal = s;
      return new Promise<ColumnStats>(() => {});
    });
    const onClose = vi.fn();
    const { unmount } = render(
      <ColumnStatsPopover
        x={0}
        y={0}
        column="amount"
        support={ALL}
        load={load}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(signal?.aborted).toBe(false);
    // The parent unmounts the popover on close, which aborts the query.
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("ignores a result that arrives after closing", async () => {
    let resolve: (value: ColumnStats) => void = () => {};
    const load = vi.fn(
      () => new Promise<ColumnStats>((r) => { resolve = r; }),
    );
    const { unmount } = render(
      <ColumnStatsPopover x={0} y={0} column="c" support={ALL} load={load} onClose={vi.fn()} />,
    );
    unmount();
    resolve(stats);
    await Promise.resolve();
    expect(screen.queryByText("dataGrid.columnStats.rows")).toBeNull();
  });

  it("shows an error with a retry that loads again", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce(stats);
    setup({ load });

    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
    fireEvent.click(screen.getByRole("button", { name: /dataGrid.columnStats.retry/ }));
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(await screen.findByText("dataGrid.columnStats.rows")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape without letting it reach the grid", async () => {
    const { onClose, onParentKeyDown } = setup();
    await screen.findByText("dataGrid.columnStats.rows");
    fireEvent.keyDown(screen.getByRole("button", { name: "dataGrid.columnStats.close" }), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalled();
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  it("closes on Escape right after it opens, while focus is on the dialog", () => {
    const { onClose, onParentKeyDown } = setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  it("closes on a click outside", async () => {
    const { onClose } = setup();
    await screen.findByText("dataGrid.columnStats.rows");
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("focuses the dialog when it opens", () => {
    setup();
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("closes with the close button", async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "dataGrid.columnStats.close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  describe("focus on close (#1138)", () => {
    // Stands in for the column header the popover was opened from.
    const renderWithHeader = (
      props: Partial<React.ComponentProps<typeof ColumnStatsPopover>> = {},
    ) => {
      const onClose = vi.fn();
      const onFilterByValue = vi.fn();
      render(<button type="button">header</button>);
      const header = screen.getByRole("button", { name: "header" });
      const returnFocusTo = vi.fn(() => header);
      const load = props.load ?? vi.fn().mockResolvedValue(stats);
      const popover = (focusTarget: () => HTMLElement | null) => (
        <ColumnStatsPopover
          x={20}
          y={20}
          column="amount"
          support={ALL}
          load={load}
          onFilterByValue={onFilterByValue}
          returnFocusTo={focusTarget}
          onClose={onClose}
        />
      );
      const { rerender } = render(popover(returnFocusTo));
      const rerenderWith = (focusTarget: () => HTMLElement | null) =>
        rerender(popover(focusTarget));
      return { header, returnFocusTo, onClose, onFilterByValue, rerenderWith };
    };

    it("returns focus to the header on Escape", () => {
      const { header, onClose } = renderWithHeader();
      expect(screen.getByRole("dialog")).toHaveFocus();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(onClose).toHaveBeenCalledOnce();
      expect(header).toHaveFocus();
    });

    it("returns focus to the header from the close button", async () => {
      const { header, onClose } = renderWithHeader();
      await screen.findByText("dataGrid.columnStats.rows");
      fireEvent.click(screen.getByRole("button", { name: "dataGrid.columnStats.close" }));
      expect(onClose).toHaveBeenCalledOnce();
      expect(header).toHaveFocus();
    });

    it("returns focus to the header when the load is cancelled", () => {
      const { header, onClose } = renderWithHeader({
        load: vi.fn(() => new Promise<ColumnStats>(() => {})),
      });
      fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
      expect(onClose).toHaveBeenCalledOnce();
      expect(header).toHaveFocus();
    });

    it("leaves focus on what was clicked outside", async () => {
      const { header, returnFocusTo, onClose } = renderWithHeader();
      await screen.findByText("dataGrid.columnStats.rows");
      render(<input aria-label="elsewhere" />);
      const elsewhere = screen.getByRole("textbox", { name: "elsewhere" });
      // A real click focuses the target on mousedown; jsdom only dispatches it.
      fireEvent.mouseDown(elsewhere);
      elsewhere.focus();
      expect(onClose).toHaveBeenCalledOnce();
      expect(returnFocusTo).not.toHaveBeenCalled();
      expect(elsewhere).toHaveFocus();
      expect(header).not.toHaveFocus();
    });

    it("leaves focus to the grid when a top value is picked", async () => {
      const { returnFocusTo, onClose, onFilterByValue } = renderWithHeader();
      const values = await screen.findAllByTitle("dataGrid.columnStats.filterBy");
      fireEvent.click(values[0]);
      expect(onFilterByValue).toHaveBeenCalledWith("7");
      expect(onClose).toHaveBeenCalledOnce();
      // Filtering re-renders the grid, which takes focus itself.
      expect(returnFocusTo).not.toHaveBeenCalled();
    });

    it("focuses the dialog only when it opens, not when its props change", () => {
      const { header, rerenderWith } = renderWithHeader();
      header.focus();
      rerenderWith(() => header);
      expect(header).toHaveFocus();
    });
  });
});
