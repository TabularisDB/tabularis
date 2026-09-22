import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PluginCard } from "../../../src/components/plugins/PluginCard";
import type { PluginManifest } from "../../../src/types/plugins";

vi.mock("lucide-react", async () => await vi.importActual("lucide-react"));
const manifest: PluginManifest = {
  id: "postgresql", name: "PostgreSQL", version: "1.0.0", description: "Database driver",
  default_port: 5432, icon: "postgres", color: "#336699",
  capabilities: { schemas: true, views: true, routines: true, file_based: false, folder_based: false, identifier_quote: '"', alter_primary_key: true },
};
const props = { name: "PostgreSQL", description: "Database driver", version: "1.0.0", actions: <button>Update</button> };

describe("PluginCard compact presentation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the connection-card geometry with manifest icon/color and an action footer", () => {
    const { container } = render(<PluginCard {...props} manifest={manifest} iconUrl="https://example.com/registry.png" />);
    expect(container.firstElementChild).toHaveClass("rounded-2xl", "border", "group");
    const iconBox = container.querySelector(".w-11.h-11");
    expect(iconBox).toHaveStyle({ backgroundColor: "#336699" });
    expect(iconBox?.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("PostgreSQL")).toHaveClass("text-sm", "font-bold");
    expect(screen.getByText("v1.0.0")).toHaveClass("rounded-md");
    expect(screen.getByRole("button", { name: "Update" }).closest(".border-t")).toHaveClass("mt-auto");
    expect(screen.queryByRole("img", { name: "update.badges.driverUpdate" })).toBeNull();
  });

  it("shows the registry icon when no manifest icon exists and falls back on image failure", () => {
    const { container } = render(<PluginCard {...props} iconUrl="https://example.com/icon.png" />);
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", "https://example.com/icon.png");
    fireEvent.error(image!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".w-11.h-11 .lucide-plug")).not.toBeNull();
  });

  it("preserves registry/homepage/author links, details and download metadata", () => {
    const showReadme = vi.fn();
    render(<PluginCard {...props}
      homepage="https://example.com/repo" registryPageUrl="https://registry.example/plugins/postgresql"
      author="Author <https://example.com/author>" downloads={12500} onShowReadme={showReadme}
    />);
    fireEvent.click(screen.getByRole("button", { name: /^PostgreSQL — / }));
    expect(openUrl).toHaveBeenCalledWith("https://registry.example/plugins/postgresql");
    fireEvent.click(screen.getByRole("button", { name: "settings.plugins.openHomepage" }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/repo");
    fireEvent.click(screen.getByRole("button", { name: "Author" }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/author");
    fireEvent.click(screen.getByRole("button", { name: "connectionCatalogue.viewDetails" }));
    expect(showReadme).toHaveBeenCalledOnce();
    expect(screen.getByText("12.5k")).toBeInTheDocument();
  });

  it("does not duplicate identical registry and homepage links", () => {
    render(<PluginCard {...props} homepage="https://example.com/" registryPageUrl="https://example.com" />);
    expect(screen.queryByRole("button", { name: "settings.plugins.openHomepage" })).not.toBeInTheDocument();
  });

  it("keeps update status informational and distinct from the enable toggle and footer action", () => {
    const toggle = vi.fn();
    render(<PluginCard {...props} updateVersion="2.0.0" status={<span>Installed</span>}
      control={<button onClick={toggle}>Disable</button>} meta={<span>SQL</span>} />);
    const indicator = screen.getByRole("img", { name: "update.badges.driverUpdate" });
    expect(indicator.textContent).toBe("v2.0.0");
    const pill = indicator.firstElementChild as HTMLElement;
    expect(pill).toHaveClass("rounded-full");
    expect(pill.style.backgroundColor).toContain("--accent-primary");
    expect(indicator.querySelector("[class*='animate-']")).toBeNull();
    expect(indicator.closest("button, a")).toBeNull();
    // Informational only: the label is exposed via role="img", not as a tab stop.
    expect(indicator).not.toHaveAttribute("tabindex");
    fireEvent.mouseEnter(indicator);
    expect(screen.getByRole("tooltip")).toHaveTextContent("update.badges.driverUpdate");
    fireEvent.mouseLeave(indicator);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(indicator);
    expect(toggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(toggle).toHaveBeenCalledOnce();
    expect(screen.getByText("SQL")).toBeInTheDocument();
  });
});
