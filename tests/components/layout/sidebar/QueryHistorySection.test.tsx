import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryHistorySection } from "../../../../src/components/layout/sidebar/QueryHistorySection";
import type { QueryHistoryEntry } from "../../../../src/types/queryHistory";

vi.mock("lucide-react", async (importOriginal) => await importOriginal());

vi.mock("../../../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: {} }),
}));

const entry: QueryHistoryEntry = {
  id: "entry-1",
  sql: "SELECT 1;",
  executedAt: "2026-10-17T12:00:00.000Z",
  executionTimeMs: 12,
  status: "success",
  rowsAffected: 1,
  error: null,
  database: "main",
};

type SectionProps = Partial<ComponentProps<typeof QueryHistorySection>>;

/** Owns the paused state like the provider does. */
function PausableSection({
  initiallyPaused = false,
  ...props
}: SectionProps & { initiallyPaused?: boolean }) {
  const [isPaused, setIsPaused] = useState(initiallyPaused);
  return (
    <QueryHistorySection
      entries={[entry]}
      isLoading={false}
      recoveryNotice={null}
      onDismissRecoveryNotice={vi.fn()}
      onDoubleClick={vi.fn()}
      onContextMenu={vi.fn()}
      onClearAll={vi.fn()}
      isPaused={isPaused}
      onTogglePaused={() => setIsPaused((prev) => !prev)}
      {...props}
    />
  );
}

const pauseToggle = () =>
  screen.getByRole("button", { name: "sidebar.pauseHistoryCapture" });
const resumeLink = () =>
  screen.queryByRole("button", { name: "sidebar.resumeHistoryCapture" });

describe.each([
  ["with history entries", [entry]],
  ["with an empty history", []],
])("QueryHistorySection pause toggle (#1212) %s", (_label, entries) => {
  it("keeps one constant name and exposes the state with aria-pressed", () => {
    render(<PausableSection entries={entries} />);

    const toggle = pauseToggle();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("title", "sidebar.pauseHistoryCapture");

    fireEvent.click(toggle);

    // Same element, same name; only the pressed state changes.
    expect(pauseToggle()).toBe(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAttribute("title", "sidebar.pauseHistoryCapture");
  });

  it("offers exactly one control per action while paused", () => {
    render(<PausableSection entries={entries} initiallyPaused />);

    expect(
      screen.getAllByRole("button", { name: "sidebar.pauseHistoryCapture" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "sidebar.resumeHistoryCapture" }),
    ).toHaveLength(1);
  });

  it("keeps the status region mounted and changes only its text", () => {
    render(<PausableSection entries={entries} />);

    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();

    fireEvent.click(pauseToggle());
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("sidebar.historyCapturePausedNotice");

    fireEvent.click(pauseToggle());
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toBeEmptyDOMElement();
  });

  it("resumes from the banner and moves focus to the toggle", () => {
    render(<PausableSection entries={entries} initiallyPaused />);

    const link = resumeLink()!;
    link.focus();
    fireEvent.click(link);

    expect(resumeLink()).toBeNull();
    expect(pauseToggle()).toHaveAttribute("aria-pressed", "false");
    expect(pauseToggle()).toHaveFocus();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("QueryHistorySection without a pause handler", () => {
  it("renders no pause controls but keeps the status region", () => {
    render(<PausableSection onTogglePaused={undefined} initiallyPaused />);

    expect(
      screen.queryByRole("button", { name: "sidebar.pauseHistoryCapture" }),
    ).toBeNull();
    expect(resumeLink()).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "sidebar.historyCapturePausedNotice",
    );
  });
});
