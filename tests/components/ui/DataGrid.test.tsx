import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";
import { DataGrid } from "../../../src/components/ui/DataGrid";
import {
  buildPkMap,
  serializePkKey,
  USE_DEFAULT_SENTINEL,
} from "../../../src/utils/dataGrid";

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({ activeSchema: null, connections: [] }),
}));

vi.mock("../../../src/hooks/useAlert", () => ({
  useAlert: () => ({ showAlert: vi.fn() }),
}));

const { showToastMock } = vi.hoisted(() => ({ showToastMock: vi.fn() }));

vi.mock("../../../src/hooks/useToast", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: {} }),
}));

vi.mock("../../../src/hooks/useRightSidebar", () => ({
  useRightSidebar: () => ({
    isOpen: false,
    activePanel: null,
    rowEditorData: null,
    isPinned: false,
    openRowEditor: vi.fn(),
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
// render every row — tests here assert behavior, not virtualization.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 35,
        end: (index + 1) * 35,
        size: 35,
      })),
    getTotalSize: () => count * 35,
    scrollToIndex: () => {},
  }),
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

  it("ignores navigation keys while a modifier is held", () => {
    const { container } = renderGrid();

    fireEvent.click(cellAt(container, 0, 0));
    fireEvent.keyDown(gridOf(container), { key: "ArrowDown", metaKey: true });

    expect(cellAt(container, 0, 0)).toHaveClass("ring-2");
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
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
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

  it("Cmd/Ctrl+click selects a column without sorting; plain click still sorts", () => {
    const { container, onSort } = renderGrid();

    fireEvent.click(screen.getByText("id"), { metaKey: true });

    expect(onSort).not.toHaveBeenCalled();
    expect(container.querySelectorAll("th")[1]).toHaveClass("bg-blue-500/20");

    fireEvent.click(screen.getByText("name"));
    expect(onSort).toHaveBeenCalledWith("name");
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
    expect(container.querySelectorAll("th")[1]).toHaveClass("bg-blue-500/20");

    // Click the row-number cell of the first row → column selection clears.
    fireEvent.click(container.querySelector("tbody tr td")!);
    expect(container.querySelectorAll("th")[1]).not.toHaveClass(
      "bg-blue-500/20",
    );
  });

  it("header context menu offers select column and copy selected columns", async () => {    const { container } = renderGrid();

    fireEvent.contextMenu(container.querySelectorAll("th")[1]);
    fireEvent.click(await screen.findByText("dataGrid.selectColumn"));
    expect(container.querySelectorAll("th")[1]).toHaveClass("bg-blue-500/20");

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

    expect(container.querySelectorAll("th")[1]).toHaveClass("bg-blue-500/20");
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
      "bg-blue-500/15",
    );
    expect(screen.getByText("Seattle").closest("td")).toHaveClass(
      "bg-blue-500/15",
    );
    expect(screen.getByText("Cara").closest("td")).not.toHaveClass(
      "bg-blue-500/15",
    );
    expect(screen.getByText("Denver").closest("td")).not.toHaveClass(
      "bg-blue-500/15",
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
    expect(container.querySelectorAll("th")[1]).toHaveClass("bg-blue-500/20");

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Seattle"), { shiftKey: true });

    expect(container.querySelectorAll("th")[1]).not.toHaveClass(
      "bg-blue-500/20",
    );
    expect(screen.getByText("Seattle").closest("td")).toHaveClass(
      "bg-blue-500/15",
    );
  });

  it("plain click clears the range and moves the anchor", async () => {
    renderGrid();

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Seattle"), { shiftKey: true });
    expect(screen.getByText("Seattle").closest("td")).toHaveClass(
      "bg-blue-500/15",
    );

    fireEvent.click(screen.getByText("Cara"));
    expect(screen.getByText("Seattle").closest("td")).not.toHaveClass(
      "bg-blue-500/15",
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
