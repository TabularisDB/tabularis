import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultEntryContent } from "../../../src/components/ui/ResultEntryContent";
import type { QueryResultEntry } from "../../../src/types/editor";

vi.mock("../../../src/components/ui/DataGrid", () => ({
  DataGrid: () => <div data-testid="mock-data-grid" />,
}));

describe("ResultEntryContent timing tooltip", () => {
  it("renders timing tooltip on total duration when server_time_ms and fetch_time_ms are present", () => {
    const entry: QueryResultEntry = {
      id: "entry-1",
      queryIndex: 0,
      query: "SELECT 1",
      isLoading: false,
      error: "",
      executionTime: 45,
      page: 1,
      activeTable: null,
      pkColumns: null,
      result: {
        columns: ["id"],
        rows: [[1]],
        affected_rows: 0,
        server_time_ms: 30,
        fetch_time_ms: 15,
      },
    };

    render(<ResultEntryContent entry={entry} connectionId="conn-1" />);

    const durationSpan = screen.getByText("(45 ms)");
    expect(durationSpan).toBeInTheDocument();
    expect(durationSpan).toHaveAttribute(
      "title",
      "Execution: 30 ms · Fetch: 15 ms · Total: 45 ms",
    );
  });

  it("does not render timing tooltip when breakdown is missing", () => {
    const entry: QueryResultEntry = {
      id: "entry-2",
      queryIndex: 0,
      query: "SELECT 1",
      isLoading: false,
      error: "",
      executionTime: 45,
      page: 1,
      activeTable: null,
      pkColumns: null,
      result: {
        columns: ["id"],
        rows: [[1]],
        affected_rows: 0,
      },
    };

    render(<ResultEntryContent entry={entry} connectionId="conn-1" />);

    const durationSpan = screen.getByText("(45 ms)");
    expect(durationSpan).toBeInTheDocument();
    expect(durationSpan).not.toHaveAttribute("title");
  });
});
