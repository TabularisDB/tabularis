import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetadataErrorIndicator } from "../../../../src/components/layout/sidebar/MetadataErrorIndicator";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("MetadataErrorIndicator", () => {
  it("shows error details and copies them", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <MetadataErrorIndicator
        error="Routine metadata unavailable"
        title="Routine metadata error"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "sidebar.errorDetails" }));
    expect(screen.getByText("Routine metadata unavailable")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "common.copy" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Routine metadata unavailable");
      expect(screen.getByRole("button", { name: "common.copied" })).toBeVisible();
    });
  });
});
