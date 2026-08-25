import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TFunction } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorDisplay } from "../../../src/components/ui/ErrorDisplay";

const labels: Record<string, string> = {
  "common.copy": "Copy",
  "common.copied": "Copied!",
  "common.copyError": "Copy error message",
  "editor.hideErrorDetails": "Hide details",
  "editor.showErrorDetails": "Show details",
};

const t = ((key: string) => labels[key] ?? key) as TFunction;

describe("ErrorDisplay", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText },
    });
  });

  it("renders selectable error text and a copy button", () => {
    render(<ErrorDisplay error="query failed" t={t} />);

    expect(screen.getByText("Error: query failed")).toBeInTheDocument();
    expect(screen.getByTitle("Copy error message")).toBeInTheDocument();
    expect(screen.getByText("Error: query failed").closest(".select-text")).toBeTruthy();
  });

  it("copies the complete error including hidden details", async () => {
    const error = "query failed\n\nstack trace line 1\nstack trace line 2";
    render(<ErrorDisplay error={error} t={t} />);

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(error);
    });
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("toggles detailed error output", () => {
    render(
      <ErrorDisplay
        error={"query failed\n\nserver detail line 1\nserver detail line 2"}
        t={t}
      />,
    );

    expect(screen.queryByText(/server detail/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

    expect(screen.getByText(/server detail line 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));

    expect(screen.queryByText(/server detail/)).not.toBeInTheDocument();
  });
});
