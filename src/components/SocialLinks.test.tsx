import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SocialLinks } from "./SocialLinks";
import { SOCIAL_LINKS } from "../config/socialLinks";
import { LINKS } from "../config/links";

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrl(url),
}));

describe("SOCIAL_LINKS", () => {
  it("includes every project social network with a valid https URL", () => {
    const labels = SOCIAL_LINKS.map((l) => l.label);
    expect(labels).toEqual(["GitHub", "Discord", "X", "Bluesky", "Mastodon"]);
    for (const link of SOCIAL_LINKS) {
      expect(link.href).toMatch(/^https:\/\//);
    }
  });

  it("sources its URLs from the generated links config", () => {
    const byLabel = Object.fromEntries(
      SOCIAL_LINKS.map((l) => [l.label, l.href]),
    );
    expect(byLabel.GitHub).toBe(LINKS.GITHUB);
    expect(byLabel.Discord).toBe(LINKS.DISCORD);
    expect(byLabel.X).toBe(LINKS.X);
    expect(byLabel.Bluesky).toBe(LINKS.BLUESKY);
    expect(byLabel.Mastodon).toBe(LINKS.MASTODON);
  });
});

describe("SocialLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders one accessible button per social network", () => {
    render(<SocialLinks />);
    for (const { label } of SOCIAL_LINKS) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("hides labels by default and shows them when requested", () => {
    const { rerender } = render(<SocialLinks />);
    expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    rerender(<SocialLinks showLabels />);
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });

  it("omits networks listed in the exclude prop", () => {
    render(<SocialLinks exclude={["GitHub", "Discord"]} />);
    expect(
      screen.queryByRole("button", { name: "GitHub" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Discord" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "X" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bluesky" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mastodon" }),
    ).toBeInTheDocument();
  });

  it("opens the matching URL externally when a button is clicked", () => {
    render(<SocialLinks />);
    fireEvent.click(screen.getByRole("button", { name: "Mastodon" }));
    expect(openUrl).toHaveBeenCalledWith(LINKS.MASTODON);
  });
});
