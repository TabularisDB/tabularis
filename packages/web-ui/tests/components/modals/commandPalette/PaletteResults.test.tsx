import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaletteResults } from "../../../../src/components/modals/commandPalette/PaletteResults";

describe("PaletteResults", () => {
  it.each(["⌘+,", undefined])(
    "renders the optional shortcut while keeping the title as the accessible name (%s)",
    (shortcut) => {
      render(
        <PaletteResults
          items={[{
            id: "settings",
            title: "Open settings",
            shortcut,
            primaryAction: {
              id: "settings",
              label: "Open settings",
              execute: vi.fn(),
            },
          }]}
          activeIndex={0}
          executionError={null}
          noResults="No results"
          onSelect={vi.fn()}
          onExecute={vi.fn()}
        />,
      );
      const row = screen.getByRole("option", { name: "Open settings" });
      if (shortcut) {
        expect(within(row).getByText(shortcut).tagName).toBe("KBD");
      } else {
        expect(row.querySelector("kbd")).toBeNull();
      }
    },
  );
});
