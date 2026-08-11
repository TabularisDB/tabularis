import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PluginReadmeModal } from "../../../src/components/modals/PluginReadmeModal";
import type { PluginReadme } from "../../../src/types/plugins";

const readme = (over: Partial<PluginReadme> = {}): PluginReadme => ({
  html: "<h1>Db2 Driver</h1><p>Connect to Db2.</p>",
  locale: "en",
  available_locales: ["en"],
  documentation_url: null,
  ...over,
});

const renderModal = () =>
  render(
    <PluginReadmeModal isOpen onClose={vi.fn()} slug="db2" pluginName="Db2" />,
  );

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(openUrl).mockReset();
});

describe("PluginReadmeModal", () => {
  it("fetches the README with the registry locale mapped from the app language", async () => {
    vi.mocked(invoke).mockResolvedValue(readme());
    renderModal();
    expect(await screen.findByText("Db2 Driver")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("fetch_plugin_readme", {
      slug: "db2",
      locale: "en",
      registryUrl: null,
    });
  });

  it("sanitizes the registry HTML before rendering it", async () => {
    vi.mocked(invoke).mockResolvedValue(
      readme({
        html: '<h1>Db2 Driver</h1><script>window.pwned = true</script><img src="x" onerror="window.pwned = true">',
      }),
    );
    renderModal();
    expect(await screen.findByText("Db2 Driver")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("<script");
    expect(document.body.innerHTML).not.toContain("onerror");
  });

  it("rewrites relative image paths against the plugin repository", async () => {
    vi.mocked(invoke).mockResolvedValue(
      readme({
        html: '<h1>Db2 Driver</h1><img src="docs/shot.png" alt="shot">',
        repo_url: "https://github.com/TabularisDB/tabularis-db2-plugin",
      }),
    );
    renderModal();
    expect(await screen.findByText("Db2 Driver")).toBeInTheDocument();
    expect(screen.getByAltText("shot")).toHaveAttribute(
      "src",
      "https://raw.githubusercontent.com/TabularisDB/tabularis-db2-plugin/HEAD/docs/shot.png",
    );
  });

  it("shows a locale fallback notice when the served locale differs from the app language", async () => {
    vi.mocked(invoke).mockResolvedValue(readme({ locale: "de" }));
    renderModal();
    expect(
      await screen.findByText(/connectionCatalogue\.readmeFallbackLocale/i),
    ).toBeInTheDocument();
  });

  it("shows no fallback notice when the served locale matches the app language", async () => {
    vi.mocked(invoke).mockResolvedValue(readme({ locale: "en" }));
    renderModal();
    expect(await screen.findByText("Db2 Driver")).toBeInTheDocument();
    expect(
      screen.queryByText(/connectionCatalogue\.readmeFallbackLocale/i),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state when the plugin has no README", async () => {
    vi.mocked(invoke).mockResolvedValue(readme({ html: null }));
    renderModal();
    expect(
      await screen.findByText(/connectionCatalogue\.readmeUnavailable/i),
    ).toBeInTheDocument();
  });

  it("degrades to the empty state when the registry has no README endpoint", async () => {
    vi.mocked(invoke).mockRejectedValue("404 not found");
    renderModal();
    expect(
      await screen.findByText(/connectionCatalogue\.readmeUnavailable/i),
    ).toBeInTheDocument();
  });

  it("opens README links through the OS opener instead of navigating", async () => {
    vi.mocked(invoke).mockResolvedValue(
      readme({ html: '<p><a href="https://example.com/docs">docs</a></p>' }),
    );
    renderModal();
    fireEvent.click(await screen.findByText("docs"));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("ignores relative README links", async () => {
    vi.mocked(invoke).mockResolvedValue(
      readme({ html: '<p><a href="./other.md">other</a></p>' }),
    );
    renderModal();
    fireEvent.click(await screen.findByText("other"));
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("offers the full documentation link when the plugin declares one", async () => {
    vi.mocked(invoke).mockResolvedValue(
      readme({ documentation_url: "https://example.com/full-docs" }),
    );
    renderModal();
    const button = await screen.findByRole("button", {
      name: /connectionCatalogue\.openDocumentation/i,
    });
    fireEvent.click(button);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/full-docs");
  });
});
