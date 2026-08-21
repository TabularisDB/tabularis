import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DiscordCommunityCallout,
  DISCORD_CALLOUT_STORAGE_KEY,
} from "../../../../src/components/layout/sidebar/DiscordCommunityCallout";
import { openUrl } from "@tauri-apps/plugin-opener";

const createMemoryStorage = (initial: Record<string, string> = {}) => {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    snapshot: () => ({ ...store }),
  };
};

describe("DiscordCommunityCallout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders on first run when storage flag is missing", () => {
    const storage = createMemoryStorage();
    render(<DiscordCommunityCallout storage={storage} />);

    expect(screen.getByTestId("discord-callout")).toBeInTheDocument();
    expect(screen.getByTestId("discord-callout-pulse")).toBeInTheDocument();
    expect(screen.getByText("discordCallout.title")).toBeInTheDocument();
    expect(screen.getByText("discordCallout.body")).toBeInTheDocument();
    expect(storage.getItem).toHaveBeenCalledWith(DISCORD_CALLOUT_STORAGE_KEY);
  });

  it("stays hidden when storage flag is already set", () => {
    const storage = createMemoryStorage({ [DISCORD_CALLOUT_STORAGE_KEY]: "true" });
    render(<DiscordCommunityCallout storage={storage} />);

    expect(screen.queryByTestId("discord-callout")).not.toBeInTheDocument();
    expect(screen.queryByTestId("discord-callout-pulse")).not.toBeInTheDocument();
  });

  it("persists dismissal and hides itself when the close button is clicked", () => {
    const storage = createMemoryStorage();
    render(<DiscordCommunityCallout storage={storage} />);

    fireEvent.click(screen.getByLabelText("discordCallout.dismiss"));

    expect(storage.setItem).toHaveBeenCalledWith(DISCORD_CALLOUT_STORAGE_KEY, "true");
    expect(screen.queryByTestId("discord-callout")).not.toBeInTheDocument();
  });

  it("opens Discord and dismisses when the CTA is clicked", () => {
    const storage = createMemoryStorage();
    render(<DiscordCommunityCallout storage={storage} />);

    fireEvent.click(screen.getByText("discordCallout.cta"));

    expect(openUrl).toHaveBeenCalledWith("https://discord.com/invite/K2hmhfHRSt");
    expect(storage.setItem).toHaveBeenCalledWith(DISCORD_CALLOUT_STORAGE_KEY, "true");
    expect(screen.queryByTestId("discord-callout")).not.toBeInTheDocument();
  });

  it("still hides for the session if storage writes throw", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    };
    render(<DiscordCommunityCallout storage={storage} />);

    fireEvent.click(screen.getByLabelText("discordCallout.dismiss"));

    expect(screen.queryByTestId("discord-callout")).not.toBeInTheDocument();
  });

  it("falls back to visible when getItem throws (e.g. privacy mode)", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(),
    };
    render(<DiscordCommunityCallout storage={storage} />);

    expect(screen.getByTestId("discord-callout")).toBeInTheDocument();
  });
});
