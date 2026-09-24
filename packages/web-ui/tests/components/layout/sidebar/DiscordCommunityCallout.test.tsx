import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TabularisClient } from "../../../../src/api/client";
import {
  DiscordCommunityCallout,
  DISCORD_CALLOUT_STORAGE_KEY,
} from "../../../../src/components/layout/sidebar/DiscordCommunityCallout";
import { UiStateStore } from "../../../../src/utils/uiStateStore";
const openUrl = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/hooks/usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => ({ openExternalUrl: openUrl }),
}));

/** A store attached to a fake backend holding `remote`. */
const createStore = (remote: Record<string, unknown> | Error = {}) => {
  const call = vi.fn(async (command: string) => {
    if (command !== "get_ui_state") return undefined;
    if (remote instanceof Error) throw remote;
    return remote;
  });
  const store = new UiStateStore();
  store.attach({ call, subscribe: vi.fn(async () => () => {}) } as unknown as TabularisClient);
  return { store, call };
};

describe("DiscordCommunityCallout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders on first run when the shared flag is missing", async () => {
    const { store } = createStore();
    render(<DiscordCommunityCallout store={store} />);

    expect(await screen.findByTestId("discord-callout")).toBeInTheDocument();
    expect(screen.getByTestId("discord-callout-pulse")).toBeInTheDocument();
    expect(screen.getByText("discordCallout.title")).toBeInTheDocument();
    expect(screen.getByText("discordCallout.body")).toBeInTheDocument();
  });

  it("does not flash before the shared state has loaded", () => {
    const store = new UiStateStore();
    render(<DiscordCommunityCallout store={store} />);
    expect(screen.queryByTestId("discord-callout")).not.toBeInTheDocument();
  });

  it("stays hidden when another host already dismissed it", async () => {
    const { store, call } = createStore({ [DISCORD_CALLOUT_STORAGE_KEY]: true });
    render(<DiscordCommunityCallout store={store} />);
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    await Promise.resolve();

    expect(screen.queryByTestId("discord-callout")).not.toBeInTheDocument();
    expect(screen.queryByTestId("discord-callout-pulse")).not.toBeInTheDocument();
  });

  it("persists dismissal and hides itself when the close button is clicked", async () => {
    const { store, call } = createStore();
    render(<DiscordCommunityCallout store={store} />);

    fireEvent.click(await screen.findByLabelText("discordCallout.dismiss"));

    expect(call).toHaveBeenCalledWith("set_ui_state", { key: DISCORD_CALLOUT_STORAGE_KEY, value: true });
    expect(screen.queryByTestId("discord-callout")).not.toBeInTheDocument();
  });

  it("opens Discord and dismisses when the CTA is clicked", async () => {
    const { store, call } = createStore();
    render(<DiscordCommunityCallout store={store} />);

    fireEvent.click(await screen.findByText("discordCallout.cta"));

    expect(openUrl).toHaveBeenCalledWith("https://discord.com/invite/K2hmhfHRSt");
    expect(call).toHaveBeenCalledWith("set_ui_state", { key: DISCORD_CALLOUT_STORAGE_KEY, value: true });
    expect(screen.queryByTestId("discord-callout")).not.toBeInTheDocument();
  });

  it("still hides for the session if the backend write fails", async () => {
    const { store, call } = createStore();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<DiscordCommunityCallout store={store} />);
    const dismiss = await screen.findByLabelText("discordCallout.dismiss");
    call.mockRejectedValueOnce(new Error("quota exceeded"));

    fireEvent.click(dismiss);

    expect(screen.queryByTestId("discord-callout")).not.toBeInTheDocument();
  });

  it("falls back to visible when the backend cannot be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store } = createStore(new Error("offline"));
    render(<DiscordCommunityCallout store={store} />);

    expect(await screen.findByTestId("discord-callout")).toBeInTheDocument();
  });

  it("migrates a dismissal an older version kept in localStorage", async () => {
    localStorage.setItem(DISCORD_CALLOUT_STORAGE_KEY, "true");
    const { store, call } = createStore();
    render(<DiscordCommunityCallout store={store} />);
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith("set_ui_state", { key: DISCORD_CALLOUT_STORAGE_KEY, value: true }),
    );

    expect(screen.queryByTestId("discord-callout")).not.toBeInTheDocument();
    expect(localStorage.getItem(DISCORD_CALLOUT_STORAGE_KEY)).toBeNull();
  });
});
