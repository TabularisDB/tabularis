import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrowserCapabilityFallbacks } from "../../../src/components/ui/BrowserCapabilityFallbacks";
import { publishBrowserCapabilityFallback } from "../../../src/platform/browserFallbacks";

describe("BrowserCapabilityFallbacks", () => {
  it("exposes denied notifications through an accessible live region", async () => {
    render(<BrowserCapabilityFallbacks />);

    act(() => {
      publishBrowserCapabilityFallback({
        kind: "notification",
        title: "Approval needed",
        body: "Review the pending request",
      });
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Approval needed",
    );
    expect(screen.getByText("Review the pending request")).toBeInTheDocument();
  });

  it("keeps a blocked external URL available as a safe actionable link", async () => {
    render(<BrowserCapabilityFallbacks />);

    act(() => {
      publishBrowserCapabilityFallback({
        kind: "external-url",
        url: "https://tabularis.dev/docs",
      });
    });

    const link = await screen.findByRole("link", {
      name: "https://tabularis.dev/docs",
    });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(link).not.toBeInTheDocument();
  });
});
