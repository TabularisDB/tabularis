import { act, render, fireEvent, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { createRef, useState, type ComponentProps } from "react";
import { vi } from "vitest";
import {
  DataGrid,
  type DataGridCommandTarget,
} from "../../../src/components/ui/DataGrid";
import {
  buildPkMap,
  serializePkKey,
  USE_DEFAULT_SENTINEL,
} from "../../../src/utils/dataGrid";

vi.mock("lucide-react", async (importOriginal) => await importOriginal());
vi.mock("../../../src/components/ui/CellCodeEditor", () => ({
  CellCodeEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <textarea aria-label="Expanded value" value={value} onChange={(event) => onChange(event.target.value)} />,
}));

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({ activeSchema: null, connections: [] }),
}));

vi.mock("../../../src/hooks/useAlert", () => ({
  useAlert: () => ({ showAlert: vi.fn() }),
}));

const {
  showToastMock,
  openRowEditorMock,
  translationMock,
  scrollToIndexMock,
  scrollToOffsetMock,
  virtualizerRenderControl,
  sidebarState,
} = vi.hoisted(() => ({
  showToastMock: vi.fn(),
  openRowEditorMock: vi.fn(),
  translationMock: vi.fn((key: string) => key),
  scrollToIndexMock: vi.fn(),
  scrollToOffsetMock: vi.fn(),
  // Lets a single test simulate the virtualizer's first, unmeasured commit,
  // where it has no virtual items yet.
  virtualizerRenderControl: { forceEmpty: false },
  sidebarState: { isOpen: false, activePanel: null as string | null },
}));

vi.mock("../../../src/hooks/useToast", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translationMock,
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
    },
  }),
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
}));

vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: {} }),
}));

vi.mock("../../../src/hooks/useRightSidebar", () => ({
  useRightSidebar: () => ({
    ...sidebarState,
    rowEditorData: null,
    isPinned: false,
    openRowEditor: openRowEditorMock,
    updateRowEditorData: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    setActivePanel: vi.fn(),
    togglePin: vi.fn(),
    onChangeRef: { current: null },
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// JSDOM has no layout, so the real virtualizer renders zero rows. Mock it to
// render every row — tests here assert behavior, not virtualization. Unless
// virtualizerRenderControl.forceEmpty is set, which simulates the real
// virtualizer's first, unmeasured commit (no virtual items yet).
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    getScrollElement,
  }: {
    count: number;
    getScrollElement: () => HTMLElement | null;
  }) => {
    const items = virtualizerRenderControl.forceEmpty
      ? []
      : Array.from({ length: count }, (_, index) => ({
          index,
          key: index,
          start: index * 35,
          end: (index + 1) * 35,
          size: 35,
        }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => count * 35,
      scrollToIndex: scrollToIndexMock,
      // The real virtualizer applies the offset to the scroll element
      // itself, and — like a real, unmeasured browser viewport — clamps it
      // to 0 when nothing has rendered yet.
      scrollToOffset: (offset: number) => {
        scrollToOffsetMock(offset);
        const el = getScrollElement();
        if (el) el.scrollTop = items.length > 0 ? offset : 0;
      },
    };
  },
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

describe("DataGrid layout", () => {
  it("keeps hidden header tooltips out of scrollable overflow", () => {
    const { container } = render(
      <DataGrid
        columns={["id", "name"]}
        data={[[1, "Alice"]]}
        columnMetadata={[
          {
            name: "id",
            data_type: "integer",
            is_pk: true,
            is_nullable: false,
            is_auto_increment: false,
          },
          {
            name: "name",
            data_type: "character varying(255)",
            is_pk: false,
            is_nullable: false,
            is_auto_increment: false,
            comment: "Customer display name",
          },
        ]}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        readonly
      />,
    );

    const table = container.querySelector("table");
    const tooltips = container.querySelectorAll('[role="tooltip"]');

    expect(table).toHaveClass("w-full");
    expect(tooltips).toHaveLength(2);
    expect(tooltips[0]).toHaveClass("hidden", "left-0");
    expect(tooltips[1]).toHaveClass("hidden", "right-0");
    expect(tooltips[1]).not.toHaveClass("left-0");
    expect(tooltips[1]).toHaveTextContent("Customer display name");
  });
});

describe("DataGrid read-only cell viewers (#654)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue("json-viewer-session");
    openRowEditorMock.mockReset();
  });

  const payload = { status: "ok" };

  const renderReadOnlyJsonGrid = () =>
    render(
      <DataGrid
        columns={["payload"]}
        data={[[payload]]}
        tableName={null}
        pkColumns={null}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        readonly
      />,
    );

  const cell = (container: HTMLElement) =>
    container.querySelector('td[data-col-index="0"]')!;

  const expectReadOnlyViewer = async () => {
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_json_viewer_window", {
        value: payload,
        originalValue: payload,
        colName: "payload",
        rowLabel: "Row 1",
        readOnly: true,
        cellKey: null,
      }),
    );
  };

  it("opens structured query results on double-click", async () => {
    const { container } = renderReadOnlyJsonGrid();

    fireEvent.doubleClick(cell(container));

    await expectReadOnlyViewer();
  });

  it("opens structured query results from the keyboard", async () => {
    const { container } = renderReadOnlyJsonGrid();
    const grid = container.querySelector('div[tabindex="0"]')!;

    fireEvent.click(cell(container));
    fireEvent.keyDown(grid, { key: "Enter" });

    await expectReadOnlyViewer();
  });

  it("opens generated JSON columns in the read-only viewer", async () => {
    const { container } = render(
      <DataGrid
        columns={["id", "payload"]}
        data={[[1, payload]]}
        columnMetadata={[
          {
            name: "id",
            data_type: "integer",
            is_pk: true,
            is_nullable: false,
            is_auto_increment: false,
          },
          {
            name: "payload",
            data_type: "jsonb",
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
            is_generated: true,
          },
        ]}
        tableName="events"
        pkColumns={["id"]}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
      />,
    );

    fireEvent.doubleClick(
      container.querySelector('td[data-col-index="1"]')!,
    );

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_json_viewer_window", {
        value: payload,
        originalValue: payload,
        colName: "payload",
        rowLabel: "id=1",
        readOnly: true,
        cellKey: 'pk:{"id":1}:payload',
      }),
    );
    expect(openRowEditorMock).not.toHaveBeenCalled();
  });

  it("does not open the editable row sidebar for read-only blob cells", () => {
    const { container } = render(
      <DataGrid
        columns={["payload"]}
        data={[["BLOB:3:application/octet-stream:AQID"]]}
        columnMetadata={[
          {
            name: "payload",
            data_type: "bytea",
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
          },
        ]}
        tableName="events"
        pkColumns={["id"]}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        readonly
      />,
    );

    fireEvent.doubleClick(cell(container));

    expect(openRowEditorMock).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("DataGrid keyboard navigation", () => {
  // The row virtualizer sizes its viewport from offsetWidth/offsetHeight, which
  // JSDOM always reports as zero — without a height no rows would be rendered.
  beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  const renderGrid = () =>
    render(
      <DataGrid
        columns={["id", "name"]}
        data={[
          [1, "Alice"],
          [2, "Bob"],
          [3, "Carol"],
        ]}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        readonly
      />,
    );

  const cellAt = (container: HTMLElement, rowIndex: number, colIndex: number) =>
    container.querySelector(
      `tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`,
    )!;

  const gridOf = (container: HTMLElement) =>
    container.querySelector('div[tabindex="0"]')!;

  it("focuses the first cell on the first arrow key press", () => {
    const { container } = renderGrid();

    fireEvent.keyDown(gridOf(container), { key: "ArrowDown" });

    expect(cellAt(container, 0, 0)).toHaveClass("ring-2");
  });

  it("focuses the grid container on cell click so key events reach it", () => {
    const { container } = renderGrid();

    fireEvent.click(cellAt(container, 0, 0));

    expect(gridOf(container)).toHaveFocus();
  });

  it("moves the focused cell with the arrow keys", () => {
    const { container } = renderGrid();

    fireEvent.click(cellAt(container, 0, 0));
    fireEvent.keyDown(gridOf(container), { key: "ArrowDown" });
    fireEvent.keyDown(gridOf(container), { key: "ArrowRight" });

    expect(cellAt(container, 1, 1)).toHaveClass("ring-2");
    expect(cellAt(container, 0, 0)).not.toHaveClass("ring-2");
  });

  it("clamps navigation at the grid edges", () => {
    const { container } = renderGrid();

    fireEvent.click(cellAt(container, 0, 0));
    fireEvent.keyDown(gridOf(container), { key: "ArrowUp" });
    fireEvent.keyDown(gridOf(container), { key: "ArrowLeft" });

    expect(cellAt(container, 0, 0)).toHaveClass("ring-2");
  });

  it("jumps to the row edges with Home and End", () => {
    const { container } = renderGrid();

    fireEvent.click(cellAt(container, 1, 0));
    fireEvent.keyDown(gridOf(container), { key: "End" });
    expect(cellAt(container, 1, 1)).toHaveClass("ring-2");

    fireEvent.keyDown(gridOf(container), { key: "Home" });
    expect(cellAt(container, 1, 0)).toHaveClass("ring-2");
  });

  it("ignores navigation keys while Alt is held", () => {
    const { container } = renderGrid();

    fireEvent.click(cellAt(container, 0, 0));
    fireEvent.keyDown(gridOf(container), { key: "ArrowDown", altKey: true });

    expect(cellAt(container, 0, 0)).toHaveClass("ring-2");
  });

  it("Cmd/Ctrl+Arrow jumps the focused cell to the grid edge", () => {
    const { container } = renderGrid();

    fireEvent.click(cellAt(container, 0, 0));
    fireEvent.keyDown(gridOf(container), { key: "ArrowDown", metaKey: true });
    expect(cellAt(container, 2, 0)).toHaveClass("ring-2");

    fireEvent.keyDown(gridOf(container), { key: "ArrowRight", ctrlKey: true });
    expect(cellAt(container, 2, 1)).toHaveClass("ring-2");

    fireEvent.keyDown(gridOf(container), { key: "Home", ctrlKey: true });
    expect(cellAt(container, 0, 0)).toHaveClass("ring-2");
  });

  it("Cmd/Ctrl+Arrow without a focused cell is left to the page-level shortcuts", () => {
    const { container } = renderGrid();

    fireEvent.keyDown(gridOf(container), { key: "ArrowRight", ctrlKey: true });

    expect(container.querySelector("td.ring-2")).toBeNull();
  });

  it("Shift+Arrow extends a cell range from the focused anchor", () => {
    const { container } = renderGrid();

    fireEvent.click(cellAt(container, 0, 0));
    fireEvent.keyDown(gridOf(container), { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(gridOf(container), { key: "ArrowRight", shiftKey: true });

    expect(cellAt(container, 0, 0)).toHaveClass("bg-accent-primary/15");
    expect(cellAt(container, 1, 1)).toHaveClass("bg-accent-primary/15");
    expect(cellAt(container, 2, 0)).not.toHaveClass("bg-accent-primary/15");

    // Ctrl+Shift+Arrow extends to the edge.
    fireEvent.keyDown(gridOf(container), {
      key: "ArrowDown",
      shiftKey: true,
      ctrlKey: true,
    });
    expect(cellAt(container, 2, 1)).toHaveClass("bg-accent-primary/15");
  });

  it("Shift+Space selects the row(s) and Cmd/Ctrl+Space the column(s) of the focused cell", () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <DataGrid
        columns={["id", "name"]}
        data={[
          [1, "Alice"],
          [2, "Bob"],
        ]}
        selectedRows={new Set()}
        onSelectionChange={onSelectionChange}
        readonly
      />,
    );

    fireEvent.click(cellAt(container, 1, 0));
    fireEvent.keyDown(gridOf(container), { key: " ", shiftKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set([1]));

    fireEvent.keyDown(gridOf(container), { key: " ", ctrlKey: true });
    expect(container.querySelectorAll("th")[1]).toHaveClass("bg-accent-primary/20");
    expect(container.querySelectorAll("th")[2]).not.toHaveClass(
      "bg-accent-primary/20",
    );

    // Ctrl+Shift+Space is the IME-safe alternative for column selection.
    fireEvent.click(cellAt(container, 1, 1));
    fireEvent.keyDown(gridOf(container), {
      key: " ",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(container.querySelectorAll("th")[2]).toHaveClass("bg-accent-primary/20");
  });

  it("leaves keys to focusable controls inside the grid", () => {
    const { container } = render(
      <DataGrid
        columns={["id", "name"]}
        data={[
          [1, "Alice"],
          [2, "Bob"],
        ]}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        onSort={vi.fn()}
        readonly
      />,
    );

    fireEvent.click(cellAt(container, 0, 0));
    fireEvent.keyDown(container.querySelector('[role="button"]')!, {
      key: "ArrowDown",
    });

    expect(cellAt(container, 0, 0)).toHaveClass("ring-2");
  });
});

describe("DataGrid keyboard editing", () => {
  beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  const cellAt = (container: HTMLElement, rowIndex: number, colIndex: number) =>
    container.querySelector(
      `tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`,
    )!;

  const gridOf = (container: HTMLElement) =>
    container.querySelector('div[tabindex="0"]')!;

  const renderEditableGrid = (
    pendingChanges?: Record<
      string,
      { pkOriginalValue: unknown; changes: Record<string, unknown> }
    >,
  ) =>
    render(
      <DataGrid
        columns={["id", "name"]}
        data={[
          [1, "Alice"],
          [2, "Bob"],
        ]}
        tableName="users"
        pkColumns={["id"]}
        columnMetadata={[
          {
            name: "id",
            data_type: "integer",
            is_pk: true,
            is_nullable: false,
            is_auto_increment: false,
          },
          {
            name: "name",
            data_type: "character varying(255)",
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
          },
        ]}
        pendingChanges={pendingChanges}
        onPendingChange={vi.fn()}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
      />,
    );

  it("opens the editor on Enter and returns focus to the grid on Escape", () => {
    const { container } = renderEditableGrid();

    fireEvent.click(cellAt(container, 0, 1));
    fireEvent.keyDown(gridOf(container), { key: "Enter" });

    const editor = container.querySelector("textarea")!;
    expect(editor).toBeInTheDocument();

    fireEvent.keyDown(editor, { key: "Escape" });

    expect(container.querySelector("textarea")).toBeNull();
    expect(gridOf(container)).toHaveFocus();
  });

  it("reports editing immediately and releases the block on cancel and unmount", async () => {
    const ref = createRef<DataGridCommandTarget>();
    const onEditingChange = vi.fn();
    const onPendingChange = vi.fn();
    const { container, unmount } = render(<DataGrid ref={ref} columns={["id", "name"]}
      data={[[1, "Alice"]]} tableName="users" pkColumns={["id"]}
      onPendingChange={onPendingChange} onEditingChange={onEditingChange} />);
    fireEvent.doubleClick(cellAt(container, 0, 1));
    expect(ref.current?.isEditing()).toBe(true);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(container.querySelector("textarea")!, { key: "Escape" });
    expect(ref.current?.isEditing()).toBe(false);
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    await act(async () => {});
    expect(onPendingChange).not.toHaveBeenCalled();
    fireEvent.doubleClick(cellAt(container, 0, 1));
    unmount();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it("blocks refresh while the expanded text editor is open", () => {
    const ref = createRef<DataGridCommandTarget>();
    const onEditingChange = vi.fn();
    render(<DataGrid ref={ref} columns={["id", "description"]}
      data={[[1, "long description ".repeat(20)]]} tableName="jobs" pkColumns={["id"]}
      columnMetadata={[{ name: "description", data_type: "text", is_pk: false, is_nullable: true, is_auto_increment: false }]}
      onPendingChange={vi.fn()} onEditingChange={onEditingChange} />);
    fireEvent.click(screen.getByRole("button", { name: "textCell.expand" }));
    expect(ref.current?.isEditing()).toBe(true);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(ref.current?.isEditing()).toBe(false);
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it("releases the row-editor block when the sidebar closes", () => {
    const ref = createRef<DataGridCommandTarget>();
    const onEditingChange = vi.fn();
    const grid = () => <DataGrid ref={ref} columns={["id"]} data={[[1]]}
      onEditingChange={onEditingChange} />;
    try {
      sidebarState.isOpen = true;
      sidebarState.activePanel = "row-editor";
      const { rerender } = render(grid());
      expect(ref.current?.isEditing()).toBe(true);
      sidebarState.isOpen = false;
      rerender(grid());
      expect(ref.current?.isEditing()).toBe(false);
      expect(onEditingChange).toHaveBeenLastCalledWith(false);
    } finally {
      sidebarState.isOpen = false;
      sidebarState.activePanel = null;
    }
  });

  it("opens an empty editor for a cell pending the database DEFAULT", () => {
    const pkVal = serializePkKey(buildPkMap(["id"], [1, "Alice"], [0]));
    const { container } = renderEditableGrid({
      [pkVal]: {
        pkOriginalValue: 1,
        changes: { name: USE_DEFAULT_SENTINEL },
      },
    });

    fireEvent.click(cellAt(container, 0, 1));
    fireEvent.keyDown(gridOf(container), { key: "Enter" });

    expect(container.querySelector("textarea")).toHaveValue("");
  });

  it("commits the prefilled date of an empty date cell once on Enter (#826)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 27, 15, 30, 0));
    try {
      const onPendingChange = vi.fn();
      const { container } = render(
        <DataGrid
          columns={["id", "due"]}
          data={[[1, null]]}
          tableName="tasks"
          pkColumns={["id"]}
          columnMetadata={[
            {
              name: "id",
              data_type: "integer",
              is_pk: true,
              is_nullable: false,
              is_auto_increment: false,
            },
            {
              name: "due",
              data_type: "date",
              is_pk: false,
              is_nullable: true,
              is_auto_increment: false,
            },
          ]}
          onPendingChange={onPendingChange}
          selectedRows={new Set()}
          onSelectionChange={vi.fn()}
        />,
      );

      fireEvent.click(cellAt(container, 0, 1));
      fireEvent.keyDown(gridOf(container), { key: "Enter" });
      fireEvent.keyDown(container.querySelector("td select")!, { key: "Enter" });

      expect(onPendingChange).toHaveBeenCalledTimes(1);
      expect(onPendingChange).toHaveBeenCalledWith({ id: 1 }, "due", "2026-09-27");
      expect(gridOf(container)).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DataGrid select all", () => {
  const columns = ["id", "name"];
  const data: unknown[][] = [
    [1, "Alice"],
    [2, "Bob"],
  ];

  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    showToastMock.mockClear();
    translationMock.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("copies pending insertions with all loaded rows", async () => {
    const commandTargetRef = createRef<DataGridCommandTarget>();
    render(
      <DataGrid
        ref={commandTargetRef}
        columns={columns}
        data={[[1, "Alice"]]}
        pendingInsertions={{
          pending: {
            tempId: "pending",
            data: { id: 2, name: "Pending" },
            displayIndex: 1,
          },
        }}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
      />,
    );

    const command = commandTargetRef.current?.getResultCommands().copyAllRows;
    expect(command?.count).toBe(2);
    await act(async () => {
      await command?.execute();
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain("Alice");
    expect(writeText.mock.calls[0][0]).toContain("Pending");
  });

  it("copies pending insertions with selected columns", async () => {
    const commandTargetRef = createRef<DataGridCommandTarget>();
    render(
      <DataGrid
        ref={commandTargetRef}
        columns={columns}
        data={[[1, "Alice"]]}
        pendingInsertions={{
          pending: {
            tempId: "pending",
            data: { id: 2, name: "Pending" },
            displayIndex: 1,
          },
        }}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("name"), { metaKey: true });
    const command =
      commandTargetRef.current?.getResultCommands().copySelectedColumns;
    await act(async () => {
      await command?.execute();
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain("Alice");
    expect(writeText.mock.calls[0][0]).toContain("Pending");
    expect(translationMock).toHaveBeenCalledWith("dataGrid.copiedRows", {
      count: 2,
    });
  });

  it("copies pending insertion values as a SQL IN clause", async () => {
    const commandTargetRef = createRef<DataGridCommandTarget>();
    render(
      <DataGrid
        ref={commandTargetRef}
        columns={columns}
        data={[[1, "Alice"]]}
        pendingInsertions={{
          pending: {
            tempId: "pending",
            data: { id: 2, name: "Pending" },
            displayIndex: 1,
          },
        }}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("name"), { metaKey: true });
    const command =
      commandTargetRef.current?.getResultCommands().copyColumnValuesAsSqlIn;
    await act(async () => {
      await command?.execute();
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain("'Alice'");
    expect(writeText.mock.calls[0][0]).toContain("'Pending'");
  });

  it("copies selected pending insertions from the row context menu", async () => {
    const { container } = render(
      <DataGrid
        columns={columns}
        data={[[1, "Alice"]]}
        pendingInsertions={{
          pending: {
            tempId: "pending",
            data: { id: 2, name: "Pending" },
            displayIndex: 1,
          },
        }}
        selectedRows={new Set([0, 1])}
        onSelectionChange={vi.fn()}
      />,
    );

    fireEvent.contextMenu(
      container.querySelector('td[data-col-index="0"]')!,
    );
    fireEvent.click(await screen.findByText("dataGrid.copySelectedN"));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain("Alice");
    expect(writeText.mock.calls[0][0]).toContain("Pending");
  });

  it("copies pending insertion values from the column context menu", async () => {
    const { container } = render(
      <DataGrid
        columns={columns}
        data={[[1, "Alice"]]}
        pendingInsertions={{
          pending: {
            tempId: "pending",
            data: { id: 2, name: "Pending" },
            displayIndex: 1,
          },
        }}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
      />,
    );

    fireEvent.contextMenu(container.querySelectorAll("th")[2]);
    fireEvent.click(await screen.findByText("dataGrid.copyColumnValues"));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain("Alice");
    expect(writeText.mock.calls[0][0]).toContain("Pending");
  });

  it("selects all loaded rows with Cmd/Ctrl+A without copying", () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <DataGrid
        columns={columns}
        data={data}
        selectedRows={new Set()}
        onSelectionChange={onSelectionChange}
        readonly
      />,
    );

    fireEvent.mouseDown(container.querySelector("table")!);
    fireEvent.keyDown(document, { key: "a", metaKey: true });

    expect(onSelectionChange).toHaveBeenCalledWith(new Set([0, 1]));
    // Selecting never touches the clipboard — copying is a separate action.
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the selected rows with Cmd/Ctrl+C", async () => {
    const Harness = () => {
      const [selected, setSelected] = useState<Set<number>>(new Set());
      return (
        <DataGrid
          columns={columns}
          data={data}
          selectedRows={selected}
          onSelectionChange={setSelected}
          readonly
        />
      );
    };
    const { container } = render(<Harness />);

    fireEvent.mouseDown(container.querySelector("table")!);
    fireEvent.keyDown(document, { key: "a", metaKey: true });
    fireEvent.keyDown(document, { key: "c", metaKey: true });

    expect(writeText).toHaveBeenCalled();
    expect(writeText.mock.calls[0][0]).toContain("Alice");
    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith("dataGrid.copiedRows", {
        kind: "success",
      }),
    );
  });

  it("copies pending insertions when selected with Cmd/Ctrl+A", async () => {
    const Harness = () => {
      const [selected, setSelected] = useState<Set<number>>(new Set());
      return (
        <DataGrid
          columns={columns}
          data={[[1, "Alice"]]}
          pendingInsertions={{
            pending: {
              tempId: "pending",
              data: { id: 2, name: "Pending" },
              displayIndex: 1,
            },
          }}
          selectedRows={selected}
          onSelectionChange={setSelected}
          readonly
        />
      );
    };
    const { container } = render(<Harness />);

    fireEvent.mouseDown(container.querySelector("table")!);
    fireEvent.keyDown(document, { key: "a", metaKey: true });
    fireEvent.keyDown(document, { key: "c", metaKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain("Alice");
    expect(writeText.mock.calls[0][0]).toContain("Pending");
  });

  it("ignores Cmd/Ctrl+A when the grid was not interacted with", () => {
    const onSelectionChange = vi.fn();
    render(
      <DataGrid
        columns={columns}
        data={data}
        selectedRows={new Set()}
        onSelectionChange={onSelectionChange}
        readonly
      />,
    );

    fireEvent.keyDown(document, { key: "a", metaKey: true });

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("ignores Cmd/Ctrl+A coming from editable targets", () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <>
        <input data-testid="external-input" />
        <DataGrid
          columns={columns}
          data={data}
          selectedRows={new Set()}
          onSelectionChange={onSelectionChange}
          readonly
        />
      </>,
    );

    fireEvent.mouseDown(container.querySelector("table")!);
    fireEvent.keyDown(screen.getByTestId("external-input"), {
      key: "a",
      metaKey: true,
    });

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("toggles select all via the # header cell", () => {
    const calls: Set<number>[] = [];
    const Harness = () => {
      const [selected, setSelected] = useState<Set<number>>(new Set());
      return (
        <DataGrid
          columns={columns}
          data={data}
          selectedRows={selected}
          onSelectionChange={(next: Set<number>) => {
            calls.push(next);
            setSelected(next);
          }}
          readonly
        />
      );
    };
    const { container } = render(<Harness />);

    const headerCell = container.querySelector("th")!;
    fireEvent.click(headerCell);
    expect(calls[0]).toEqual(new Set([0, 1]));

    fireEvent.click(headerCell);
    expect(calls[1]).toEqual(new Set());
  });

  it("offers Select All in the row context menu", async () => {
    const onSelectionChange = vi.fn();
    render(
      <DataGrid
        columns={columns}
        data={data}
        tableName="users"
        selectedRows={new Set()}
        onSelectionChange={onSelectionChange}
        readonly
      />,
    );

    fireEvent.contextMenu(screen.getByText("Alice"));

    const item = await screen.findByText("dataGrid.selectAllN");
    fireEvent.click(item);

    expect(onSelectionChange).toHaveBeenCalledWith(new Set([0, 1]));
  });

  it("offers Copy All with the total count when rows are unloaded", async () => {
    const onCopyAllRows = vi.fn();
    render(
      <DataGrid
        columns={columns}
        data={data}
        tableName="users"
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        totalRows={10}
        onCopyAllRows={onCopyAllRows}
        readonly
      />,
    );

    fireEvent.contextMenu(screen.getByText("Alice"));

    // Both scopes are explicit in the menu: the selection and the full result.
    expect(await screen.findByText("dataGrid.copySelectedN")).toBeTruthy();

    const item = await screen.findByText("dataGrid.copyAllRows");
    fireEvent.click(item);

    expect(onCopyAllRows).toHaveBeenCalled();
  });

  it("offers Copy All without a count when the total is unknown", async () => {
    const onCopyAllRows = vi.fn();
    render(
      <DataGrid
        columns={columns}
        data={data}
        tableName="users"
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        totalRows={null}
        hasMore
        onCopyAllRows={onCopyAllRows}
        readonly
      />,
    );

    fireEvent.contextMenu(screen.getByText("Alice"));

    const item = await screen.findByText("dataGrid.copyAll");
    fireEvent.click(item);

    expect(onCopyAllRows).toHaveBeenCalled();
  });

  it("copies a full-page selection instantly and reports N of M in the toast", async () => {
    const onCopyAllRows = vi.fn();
    const Harness = () => {
      const [selected, setSelected] = useState<Set<number>>(new Set());
      return (
        <DataGrid
          columns={columns}
          data={data}
          selectedRows={selected}
          onSelectionChange={setSelected}
          totalRows={10}
          onCopyAllRows={onCopyAllRows}
          readonly
        />
      );
    };
    const { container } = render(<Harness />);

    fireEvent.mouseDown(container.querySelector("table")!);
    fireEvent.keyDown(document, { key: "a", metaKey: true });

    // Selecting alone never copies.
    expect(writeText).not.toHaveBeenCalled();

    // Copying is instant — no dialog, no copy-all fetch. The toast states
    // "loaded of total" so a page-only copy is never silent.
    fireEvent.keyDown(document, { key: "c", metaKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(onCopyAllRows).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(
        "dataGrid.copiedRowsOfTotal",
        { kind: "success" },
      ),
    );
  });
});

describe("DataGrid column selection", () => {
  const columns = ["id", "name"];
  const data: unknown[][] = [
    [1, "Alice"],
    [2, "Bob"],
  ];

  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    showToastMock.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  const renderGrid = (onSort = vi.fn()) => {
    const utils = render(
      <DataGrid
        columns={columns}
        data={data}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        onSort={onSort}
        readonly
      />,
    );
    return { ...utils, onSort };
  };

  it("Cmd/Ctrl+click toggles a column without sorting", () => {
    const { container, onSort } = renderGrid();

    fireEvent.click(screen.getByText("id"), { metaKey: true });

    expect(onSort).not.toHaveBeenCalled();
    expect(container.querySelectorAll("th")[1]).toHaveClass("bg-accent-primary/20");

    fireEvent.click(screen.getByText("id"), { metaKey: true });
    expect(container.querySelectorAll("th")[1]).not.toHaveClass(
      "bg-accent-primary/20",
    );
  });

  it("plain header click selects a single column; sorting is on the sort button", () => {
    const { container, onSort } = renderGrid();

    fireEvent.click(screen.getByText("id"));
    expect(onSort).not.toHaveBeenCalled();
    expect(container.querySelectorAll("th")[1]).toHaveClass("bg-accent-primary/20");

    // Plain click replaces the selection instead of adding to it.
    fireEvent.click(screen.getByText("name"));
    expect(container.querySelectorAll("th")[1]).not.toHaveClass(
      "bg-accent-primary/20",
    );
    expect(container.querySelectorAll("th")[2]).toHaveClass("bg-accent-primary/20");

    fireEvent.click(screen.getAllByLabelText("dataGrid.sortByAsc")[0]);
    expect(onSort).toHaveBeenCalledWith("id");
  });

  it("copies only the selected columns with Cmd/Ctrl+C", async () => {
    renderGrid();

    fireEvent.click(screen.getByText("id"), { metaKey: true });
    fireEvent.keyDown(document, { key: "c", metaKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("id");
    expect(copied).not.toContain("Alice");
    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith("dataGrid.copiedRows", {
        kind: "success",
      }),
    );
  });

  it("Shift+click range-selects columns from the anchor", async () => {
    renderGrid();

    fireEvent.click(screen.getByText("id"), { metaKey: true });
    fireEvent.click(screen.getByText("name"), { shiftKey: true });
    fireEvent.keyDown(document, { key: "c", metaKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Alice");
  });

  it("row selection clears column selection and vice versa", () => {
    const { container } = renderGrid();

    fireEvent.click(screen.getByText("id"), { metaKey: true });
    expect(container.querySelectorAll("th")[1]).toHaveClass("bg-accent-primary/20");

    // Click the row-number cell of the first row → column selection clears.
    fireEvent.click(container.querySelector("tbody tr td")!);
    expect(container.querySelectorAll("th")[1]).not.toHaveClass(
      "bg-accent-primary/20",
    );
  });

  it("header context menu offers select column and copy selected columns", async () => {    const { container } = renderGrid();

    fireEvent.contextMenu(container.querySelectorAll("th")[1]);
    fireEvent.click(await screen.findByText("dataGrid.selectColumn"));
    expect(container.querySelectorAll("th")[1]).toHaveClass("bg-accent-primary/20");

    fireEvent.contextMenu(container.querySelectorAll("th")[1]);
    const item = await screen.findByText("dataGrid.copySelectedColumns");
    fireEvent.click(item);

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).not.toContain("Alice");
  });

  it("Ctrl+click on macOS (contextmenu event) toggles the column without opening the menu", () => {
    const { container } = renderGrid();

    // macOS turns Ctrl+click into a contextmenu event on the header.
    fireEvent.contextMenu(container.querySelectorAll("th")[1], {
      ctrlKey: true,
    });

    expect(container.querySelectorAll("th")[1]).toHaveClass("bg-accent-primary/20");
    expect(screen.queryByText("dataGrid.copyColumnName")).toBeNull();
  });
});

describe("DataGrid cell range selection", () => {
  const columns = ["id", "name", "city"];
  const data: unknown[][] = [
    [1, "Alice", "Portland"],
    [2, "Bob", "Seattle"],
    [3, "Cara", "Denver"],
  ];

  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    showToastMock.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  const renderGrid = (tableName?: string) =>
    render(
      <DataGrid
        columns={columns}
        data={data}
        tableName={tableName}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        readonly
      />,
    );

  it("Shift+click extends a rectangular range from the focused cell", () => {
    renderGrid();

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Seattle"), { shiftKey: true });

    // Range rows 0-1 × cols 1-2 highlighted; outside cells are not.
    expect(screen.getByText("Alice").closest("td")).toHaveClass(
      "bg-accent-primary/15",
    );
    expect(screen.getByText("Seattle").closest("td")).toHaveClass(
      "bg-accent-primary/15",
    );
    expect(screen.getByText("Cara").closest("td")).not.toHaveClass(
      "bg-accent-primary/15",
    );
    expect(screen.getByText("Denver").closest("td")).not.toHaveClass(
      "bg-accent-primary/15",
    );
  });

  it("copies only the range with Cmd/Ctrl+C", async () => {
    renderGrid();

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Seattle"), { shiftKey: true });
    fireEvent.keyDown(document, { key: "c", metaKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied.startsWith("name,city")).toBe(true);
    expect(copied).toContain("Alice,Portland");
    expect(copied).toContain("Bob,Seattle");
    expect(copied).not.toContain("Cara");
    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith("dataGrid.copiedCells", {
        kind: "success",
      }),
    );
  });

  it("is mutually exclusive with column selection", () => {
    const { container } = renderGrid();

    fireEvent.click(screen.getByText("id"), { metaKey: true });
    expect(container.querySelectorAll("th")[1]).toHaveClass("bg-accent-primary/20");

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Seattle"), { shiftKey: true });

    expect(container.querySelectorAll("th")[1]).not.toHaveClass(
      "bg-accent-primary/20",
    );
    expect(screen.getByText("Seattle").closest("td")).toHaveClass(
      "bg-accent-primary/15",
    );
  });

  it("plain click clears the range and moves the anchor", async () => {
    renderGrid();

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Seattle"), { shiftKey: true });
    expect(screen.getByText("Seattle").closest("td")).toHaveClass(
      "bg-accent-primary/15",
    );

    fireEvent.click(screen.getByText("Cara"));
    expect(screen.getByText("Seattle").closest("td")).not.toHaveClass(
      "bg-accent-primary/15",
    );

    // New anchor: Shift+click now ranges from Cara's row only.
    fireEvent.click(screen.getByText("Denver"), { shiftKey: true });
    fireEvent.keyDown(document, { key: "c", metaKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Cara,Denver");
    expect(copied).not.toContain("Alice");
  });

  it("offers Copy Range in the row context menu", async () => {
    renderGrid("users");

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Seattle"), { shiftKey: true });

    fireEvent.contextMenu(screen.getByText("Portland"));
    fireEvent.click(await screen.findByText("dataGrid.copyRangeN"));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Alice,Portland");
    expect(copied).not.toContain("Cara");
  });
});

describe("DataGrid JSON context menu", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue("json-viewer-session");
  });

  it("opens value-detected JSON cells in read-only grids without metadata", async () => {
    const payload = { status: "ok" };
    const { container } = render(
      <DataGrid
        columns={["payload"]}
        data={[[payload]]}
        tableName={null}
        pkColumns={null}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        readonly
      />,
    );

    fireEvent.contextMenu(
      container.querySelector('td[data-col-index="0"]')!,
    );
    const openJsonItem = await screen.findByText("contextMenu.openJsonEditor");
    expect(screen.queryByText("dataGrid.setNull")).toBeNull();
    expect(screen.queryByText("contextMenu.openSidebar")).toBeNull();
    fireEvent.click(openJsonItem);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_json_viewer_window", {
        value: payload,
        originalValue: payload,
        colName: "payload",
        rowLabel: "Row 1",
        readOnly: true,
        cellKey: null,
      }),
    );
  });

  it("opens value-detected JSON cells in tableless query results", async () => {
    const payload = { status: "ok" };
    const { container } = render(
      <DataGrid
        columns={["payload"]}
        data={[[payload]]}
        tableName={null}
        pkColumns={null}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
      />,
    );

    fireEvent.contextMenu(
      container.querySelector('td[data-col-index="0"]')!,
    );
    const openJsonItem = await screen.findByText("contextMenu.openJsonEditor");
    expect(screen.queryByText("dataGrid.setNull")).toBeNull();
    expect(screen.queryByText("dataGrid.pasteCells")).toBeNull();
    expect(screen.queryByText("contextMenu.openSidebar")).toBeNull();
    fireEvent.click(openJsonItem);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_json_viewer_window", {
        value: payload,
        originalValue: payload,
        colName: "payload",
        rowLabel: "Row 1",
        readOnly: true,
        cellKey: null,
      }),
    );
  });
});

describe("DataGrid sensitive-column masking (#485)", () => {
  // The file-level useSettings mock returns `{}`, so masking defaults to ON
  // with DEFAULT_MASKING_PATTERNS — a column named "email" masks by default.
  beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  const cellAt = (container: HTMLElement, rowIndex: number, colIndex: number) =>
    container.querySelector(
      `tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`,
    )!;

  const renderMaskedGrid = () =>
    render(
      <DataGrid
        columns={["id", "email"]}
        data={[
          [1, "alice@example.com"],
          [2, "bob@example.com"],
        ]}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        readonly
      />,
    );

  it("masks sensitive columns with a placeholder and hides the real value", () => {
    const { container } = renderMaskedGrid();

    expect(cellAt(container, 0, 1)).toHaveTextContent("••••••");
    expect(cellAt(container, 1, 1)).toHaveTextContent("••••••");
    expect(container).not.toHaveTextContent("alice@example.com");
    // Non-sensitive columns are untouched.
    expect(cellAt(container, 0, 0)).toHaveTextContent("1");
  });

  it("reveals a whole column from the header eye toggle", () => {
    const { container } = renderMaskedGrid();

    const headerToggle = container.querySelector(
      'button[title="dataGrid.revealColumn"]',
    )!;
    expect(headerToggle).toBeInTheDocument();
    fireEvent.click(headerToggle);

    expect(cellAt(container, 0, 1)).toHaveTextContent("alice@example.com");
    expect(cellAt(container, 1, 1)).toHaveTextContent("bob@example.com");
    // Toggling again re-masks the column.
    fireEvent.click(
      container.querySelector('button[title="dataGrid.maskColumn"]')!,
    );
    expect(cellAt(container, 0, 1)).toHaveTextContent("••••••");
  });

  it("reveals only a single cell from its eye button", () => {
    const { container } = renderMaskedGrid();

    const cellToggle = cellAt(container, 1, 1).querySelector(
      'button[title="dataGrid.revealCell"]',
    )!;
    fireEvent.click(cellToggle);

    expect(cellAt(container, 1, 1)).toHaveTextContent("bob@example.com");
    expect(cellAt(container, 0, 1)).toHaveTextContent("••••••");

    // The revealed cell offers an eye-off toggle to re-mask just that cell.
    fireEvent.click(
      cellAt(container, 1, 1).querySelector('button[title="dataGrid.maskCell"]')!,
    );
    expect(cellAt(container, 1, 1)).toHaveTextContent("••••••");
  });

  it("copies the real value from a masked cell (display-only masking)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { container } = renderMaskedGrid();

    fireEvent.click(cellAt(container, 0, 1));
    fireEvent.keyDown(document, { key: "c", metaKey: true });

    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("alice@example.com"),
    );
  });

  it("does not open the editor on double-click while a cell is masked", () => {
    const { container } = render(
      <DataGrid
        columns={["id", "email"]}
        data={[[1, "alice@example.com"]]}
        tableName="users"
        pkColumns={["id"]}
        columnMetadata={[
          {
            name: "id",
            data_type: "integer",
            is_pk: true,
            is_nullable: false,
            is_auto_increment: false,
          },
          {
            name: "email",
            data_type: "character varying(255)",
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
          },
        ]}
        onPendingChange={vi.fn()}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
      />,
    );

    fireEvent.doubleClick(cellAt(container, 0, 1));

    expect(container.querySelector("textarea")).toBeNull();

    // After revealing the cell, editing works again.
    fireEvent.click(
      cellAt(container, 0, 1).querySelector(
        'button[title="dataGrid.revealCell"]',
      )!,
    );
    fireEvent.doubleClick(cellAt(container, 0, 1));
    expect(container.querySelector("textarea")).toBeInTheDocument();
  });
});

describe("DataGrid filter-by-value context menu", () => {
  const cellAt = (container: HTMLElement, rowIndex: number, colIndex: number) =>
    container.querySelector(
      `tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`,
    )!;

  const usersMetadata = [
    {
      name: "id",
      data_type: "integer",
      is_pk: true,
      is_nullable: false,
      is_auto_increment: false,
    },
    {
      name: "name",
      data_type: "character varying(255)",
      is_pk: false,
      is_nullable: true,
      is_auto_increment: false,
    },
    {
      name: "email",
      data_type: "character varying(255)",
      is_pk: false,
      is_nullable: true,
      is_auto_increment: false,
    },
    {
      name: "avatar",
      data_type: "bytea",
      is_pk: false,
      is_nullable: true,
      is_auto_increment: false,
    },
    {
      name: "settings",
      data_type: "jsonb",
      is_pk: false,
      is_nullable: true,
      is_auto_increment: false,
    },
  ];

  const renderUsersGrid = (
    overrides: Partial<ComponentProps<typeof DataGrid>> = {},
  ) => {
    const onFilterByValue = vi.fn();
    const utils = render(
      <DataGrid
        columns={["id", "name", "email", "avatar", "settings"]}
        data={[[1, "Alice", "alice@example.com", "BLOB:3:image/png:AAEC", { theme: "dark" }]]}
        tableName="users"
        pkColumns={["id"]}
        columnMetadata={usersMetadata}
        onFilterByValue={onFilterByValue}
        // Read-only keeps the editing items (and their icons) out of the
        // menu; the filter items only depend on tableName.
        readonly
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        {...overrides}
      />,
    );
    return { ...utils, onFilterByValue };
  };

  it("offers = / <> on a regular cell and passes the cell value", async () => {
    const { container, onFilterByValue } = renderUsersGrid();

    fireEvent.contextMenu(cellAt(container, 0, 1));
    fireEvent.click(await screen.findByText("dataGrid.filterEquals"));

    expect(screen.queryByText("dataGrid.filterIsNull")).toBeNull();
    expect(onFilterByValue).toHaveBeenCalledWith(
      "name",
      "=",
      "Alice",
      "character varying(255)",
    );
  });

  it("offers only IS NULL / IS NOT NULL on a masked cell and never passes its value", async () => {
    const { container, onFilterByValue } = renderUsersGrid();

    // "email" is masked by DEFAULT_MASKING_PATTERNS (settings mock is `{}`).
    expect(cellAt(container, 0, 2)).toHaveTextContent("••••••");
    fireEvent.contextMenu(cellAt(container, 0, 2));

    expect(await screen.findByText("dataGrid.filterIsNull")).toBeInTheDocument();
    expect(screen.getByText("dataGrid.filterIsNotNull")).toBeInTheDocument();
    expect(screen.queryByText("dataGrid.filterEquals")).toBeNull();
    expect(screen.queryByText("dataGrid.filterNotEquals")).toBeNull();

    fireEvent.click(screen.getByText("dataGrid.filterIsNotNull"));
    expect(onFilterByValue).toHaveBeenCalledWith(
      "email",
      "IS NOT NULL",
      null,
      "character varying(255)",
    );
    expect(JSON.stringify(onFilterByValue.mock.calls)).not.toContain(
      "alice@example.com",
    );
  });

  it("offers = / <> again once the masked cell is revealed", async () => {
    const { container } = renderUsersGrid();

    fireEvent.click(
      cellAt(container, 0, 2).querySelector(
        'button[title="dataGrid.revealCell"]',
      )!,
    );
    fireEvent.contextMenu(cellAt(container, 0, 2));

    expect(await screen.findByText("dataGrid.filterEquals")).toBeInTheDocument();
    expect(screen.queryByText("dataGrid.filterIsNull")).toBeNull();
  });

  it("hides the items on BLOB and JSON cells", async () => {
    const { container } = renderUsersGrid();

    fireEvent.contextMenu(cellAt(container, 0, 3));
    // Wait for the menu itself, then check the filter items are absent.
    await screen.findByText("dataGrid.copyCell");
    expect(screen.queryByText("dataGrid.filterEquals")).toBeNull();
    expect(screen.queryByText("dataGrid.filterIsNull")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.contextMenu(cellAt(container, 0, 4));
    await screen.findByText("contextMenu.openJsonEditor");
    expect(screen.queryByText("dataGrid.filterEquals")).toBeNull();
    expect(screen.queryByText("dataGrid.filterIsNull")).toBeNull();
  });

  it("hides the items on pending insertion rows", async () => {
    const { container } = renderUsersGrid({
      pendingInsertions: {
        pending: {
          tempId: "pending",
          data: { id: 2, name: "Bob" },
          displayIndex: 1,
        },
      },
    });

    fireEvent.contextMenu(cellAt(container, 1, 1));
    await screen.findByText("dataGrid.copyCell");
    expect(screen.queryByText("dataGrid.filterEquals")).toBeNull();
    expect(screen.queryByText("dataGrid.filterIsNull")).toBeNull();
  });

  it("hides the items when there is no table (query results)", async () => {
    const { container } = renderUsersGrid({ tableName: null });

    fireEvent.contextMenu(cellAt(container, 0, 1));
    await screen.findByText("dataGrid.copyCell");
    expect(screen.queryByText("dataGrid.filterEquals")).toBeNull();
  });
});

describe("DataGrid vertical scroll position across tab switches (#823)", () => {
  // Editor.tsx keys the <DataGrid> it renders by the active tab's id (plus
  // sort/filter/result state), so switching tabs fully unmounts the previous
  // grid and mounts a fresh one for the newly active tab — it does not just
  // hide it. Editor.tsx is expected to remember the last scrollTop it saw
  // (via onScrollTopChange) and hand it back as initialScrollTop when the
  // tab's grid is remounted.
  it("restores the scrollTop the caller passes back in as initialScrollTop", () => {
    scrollToOffsetMock.mockClear();
    const columns = ["id"];
    const data = Array.from({ length: 200 }, (_, i) => [i]);

    const { container, unmount } = render(
      <DataGrid
        columns={columns}
        data={data}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
      />,
    );
    const scrollEl = container.querySelector(".overflow-auto") as HTMLElement;
    expect(scrollEl).not.toBeNull();

    fireEvent.scroll(scrollEl, { target: { scrollTop: 400 } });
    expect(scrollEl.scrollTop).toBe(400);

    // Simulate switching away and back to this tab: the old grid is gone,
    // a brand new one is mounted in its place.
    unmount();

    const { container: container2 } = render(
      <DataGrid
        columns={columns}
        data={data}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        initialScrollTop={400}
      />,
    );
    const scrollEl2 = container2.querySelector(
      ".overflow-auto",
    ) as HTMLElement;

    expect(scrollToOffsetMock).toHaveBeenCalledWith(400);
    expect(scrollEl2.scrollTop).toBe(400);
  });

  it("reports scroll position changes via onScrollTopChange", () => {
    const onScrollTopChange = vi.fn();
    const { container } = render(
      <DataGrid
        columns={["id"]}
        data={Array.from({ length: 200 }, (_, i) => [i])}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        onScrollTopChange={onScrollTopChange}
      />,
    );
    const scrollEl = container.querySelector(".overflow-auto") as HTMLElement;

    fireEvent.scroll(scrollEl, { target: { scrollTop: 250 } });

    expect(onScrollTopChange).toHaveBeenCalledWith(250);
  });

  // Editor.tsx also remounts this grid when a pending insertion is added,
  // and separately decides — outside this component's own lifecycle,
  // because a fresh mount can never observe its own "count changed" —
  // whether this mount is that kind of insert. It passes that decision in
  // as scrollToNewInsertion, which must win over any restored offset from
  // the grid's previous mount: an inserted row should always be scrolled
  // into view, never left below a stale scroll position.
  it("scrolls to the newly inserted row instead of restoring initialScrollTop when both are set", () => {
    scrollToIndexMock.mockClear();
    scrollToOffsetMock.mockClear();
    const data = Array.from({ length: 200 }, (_, i) => [i]);

    const { container } = render(
      <DataGrid
        columns={["id"]}
        data={data}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        initialScrollTop={5000}
        scrollToNewInsertion
      />,
    );

    expect(scrollToIndexMock).toHaveBeenCalledWith(data.length - 1, {
      align: "end",
    });

    // The restore path must not also have run: it goes through
    // scrollToOffset, which would clobber whatever the (mocked)
    // scroll-to-bottom did.
    expect(scrollToOffsetMock).not.toHaveBeenCalled();
    const scrollEl = container.querySelector(".overflow-auto") as HTMLElement;
    expect(scrollEl.scrollTop).toBe(0);
  });

  it("restores initialScrollTop when there is no new insertion to scroll to", () => {
    scrollToIndexMock.mockClear();
    scrollToOffsetMock.mockClear();
    const data = Array.from({ length: 200 }, (_, i) => [i]);

    const { container } = render(
      <DataGrid
        columns={["id"]}
        data={data}
        selectedRows={new Set()}
        onSelectionChange={vi.fn()}
        initialScrollTop={400}
        scrollToNewInsertion={false}
      />,
    );

    expect(scrollToIndexMock).not.toHaveBeenCalled();
    expect(scrollToOffsetMock).toHaveBeenCalledWith(400);
    const scrollEl = container.querySelector(".overflow-auto") as HTMLElement;
    expect(scrollEl.scrollTop).toBe(400);
  });

  // The real virtualizer renders no rows on its very first commit, before
  // it has measured the scroll container. Restoring then would call
  // scrollToOffset while the container's scrollHeight still equals its
  // clientHeight, which clamps the offset to 0 — and the has-run ref would
  // then mark the restore done for good, so it never gets another chance.
  it("restores initialScrollTop once the virtualizer has rendered rows, not on the first, empty render", () => {
    scrollToOffsetMock.mockClear();
    virtualizerRenderControl.forceEmpty = true;
    let forceRerender = () => {};
    const data = Array.from({ length: 200 }, (_, i) => [i]);
    const Harness = () => {
      const [, setTick] = useState(0);
      forceRerender = () => setTick((n) => n + 1);
      return (
        <DataGrid
          columns={["id"]}
          data={data}
          selectedRows={new Set()}
          onSelectionChange={vi.fn()}
          initialScrollTop={400}
        />
      );
    };

    try {
      const { container } = render(<Harness />);
      const scrollEl = container.querySelector(
        ".overflow-auto",
      ) as HTMLElement;

      // No rows rendered yet: the restore must not fire.
      expect(scrollToOffsetMock).not.toHaveBeenCalled();
      expect(scrollEl.scrollTop).toBe(0);

      // The virtualizer measures the viewport and re-renders with rows.
      virtualizerRenderControl.forceEmpty = false;
      act(() => forceRerender());

      expect(scrollToOffsetMock).toHaveBeenCalledWith(400);
      expect(scrollEl.scrollTop).toBe(400);
    } finally {
      virtualizerRenderControl.forceEmpty = false;
    }
  });
});
