import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectionErrorBanner } from "../../src/components/ConnectionErrorBanner";

describe("ConnectionErrorBanner", () => {
  const clipboardWriteText = vi.fn();
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup({ writeToClipboard: false });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
      writable: true,
    });
  });

  it("copies the complete message including collapsed details", async () => {
    const message = "Connection failed\n\nError: TLS certificate detail";
    render(<ConnectionErrorBanner message={message} onClose={vi.fn()} />);

    expect(screen.queryByText("Error: TLS certificate detail")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "sidebar.copyError" }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(message);
    });
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it("names and types the close button", () => {
    render(<ConnectionErrorBanner message="Connection failed" onClose={vi.fn()} />);

    const closeButton = screen.getByRole("button", { name: /close/i });
    expect(closeButton).toHaveAttribute("type", "button");
  });

  it("exposes the details toggle state", async () => {
    render(
      <ConnectionErrorBanner
        message={"Connection failed\n\nError: TLS certificate detail"}
        onClose={vi.fn()}
      />,
    );

    const detailsButton = screen.getByRole("button", {
      name: "common.showDetails",
    });
    expect(detailsButton).toHaveAttribute("aria-expanded", "false");

    await user.click(detailsButton);
    expect(detailsButton).toHaveAttribute("aria-expanded", "true");
  });
});
