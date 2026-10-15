import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatGptSettings } from "../../../src/components/settings/ChatGptSettings";
import type { ChatGptSession } from "../../../src/types/chatgpt";

const { invoke, updateSetting } = vi.hoisted(() => ({
  invoke: vi.fn(),
  updateSetting: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { aiModel: null }, updateSetting }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const connected: ChatGptSession = {
  activeProfileId: "first",
  profiles: [
    {
      id: "first",
      label: "Connection 1",
      email: "same@example.com",
      connected: true,
      sharing: true,
    },
    {
      id: "second",
      label: "Connection 2",
      email: "same@example.com",
      connected: true,
      sharing: true,
    },
  ],
};
let current: ChatGptSession;

describe("ChatGptSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current = { activeProfileId: null, profiles: [] };
    updateSetting.mockResolvedValue(undefined);
    invoke.mockImplementation(
      async (command: string, args?: { profileId?: string }) => {
        if (command === "get_chatgpt_session") return current;
        if (command === "get_chatgpt_models")
          return [{ slug: "account-model", displayName: "Account Model" }];
        if (command === "sign_in_chatgpt") {
          current = connected;
          return current;
        }
        if (command === "select_chatgpt_profile") {
          current = { ...connected, activeProfileId: args?.profileId ?? null };
          return current;
        }
        if (command === "sign_out_chatgpt") {
          current = {
            ...connected,
            profiles: connected.profiles.map((p) =>
              p.id === args?.profileId
                ? { ...p, connected: false, sharing: false }
                : p,
            ),
          };
          return "Remote revocation was not confirmed.";
        }
        return null;
      },
    );
  });

  it("offers browser sign-in without API-key inputs and loads account models", async () => {
    render(<ChatGptSettings />);
    const button = screen.getByRole("button", {
      name: "settings.ai.chatgpt.continue",
    });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(button);
    await screen.findByText("settings.ai.chatgpt.usingPlan");
    expect(invoke).toHaveBeenCalledWith("sign_in_chatgpt", { profileId: null });
    expect(updateSetting).toHaveBeenCalledWith("aiModel", "");
    expect(invoke).toHaveBeenCalledWith("get_chatgpt_models");
    fireEvent.click(
      screen.getByRole("button", { name: "settings.ai.defaultModel" }),
    );
    fireEvent.click(await screen.findByText("Account Model"));
    expect(updateSetting).toHaveBeenCalledWith("aiModel", "account-model");
  });

  it("does not discover models for identity-only authorization", async () => {
    current = {
      ...connected,
      profiles: connected.profiles.map((p) => ({ ...p, sharing: false })),
    };
    render(<ChatGptSettings />);
    await screen.findByText("settings.ai.chatgpt.permissionRequired");
    expect(invoke).not.toHaveBeenCalledWith("get_chatgpt_models");
    expect(
      screen.queryByRole("button", { name: "settings.ai.defaultModel" }),
    ).not.toBeInTheDocument();
  });

  it("keeps same-email registrations separate when switching accounts", async () => {
    current = connected;
    render(<ChatGptSettings />);
    const picker = await screen.findByRole("button", {
      name: "settings.ai.chatgpt.account",
    });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.click(picker);
    fireEvent.click(await screen.findByText("Connection 2 · same@example.com"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("select_chatgpt_profile", {
        profileId: "second",
      }),
    );
    expect(updateSetting).toHaveBeenCalledWith("aiModel", "");
  });

  it("signs out locally, hides models and reports unconfirmed remote revocation", async () => {
    current = connected;
    render(<ChatGptSettings />);
    const button = await screen.findByRole("button", {
      name: "settings.ai.chatgpt.signOut",
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Remote revocation was not confirmed.",
    );
    expect(
      screen.queryByRole("button", { name: "settings.ai.defaultModel" }),
    ).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("sign_out_chatgpt", {
      profileId: "first",
    });
  });

  it("makes usage management available after model-discovery failures", async () => {
    current = connected;
    invoke.mockImplementation(async (command: string) => {
      if (command === "get_chatgpt_session") return current;
      if (command === "get_chatgpt_models")
        throw new Error("ChatGPT usage limit reached");
      return null;
    });
    render(<ChatGptSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "usage limit reached",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "settings.ai.chatgpt.manageUsage" }),
    );
    expect(invoke).toHaveBeenCalledWith("open_chatgpt_usage");
  });

  it("cancels a pending browser sign-in when the settings panel unmounts", async () => {
    let rejectSignIn: ((reason: Error) => void) | undefined;
    invoke.mockImplementation(async (command: string) => {
      if (command === "get_chatgpt_session") return current;
      if (command === "sign_in_chatgpt")
        return new Promise((_resolve, reject) => {
          rejectSignIn = reject;
        });
      return null;
    });
    const { unmount } = render(<ChatGptSettings />);
    const button = screen.getByRole("button", {
      name: "settings.ai.chatgpt.continue",
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByText("settings.ai.chatgpt.browserPending");
    unmount();
    expect(invoke).toHaveBeenCalledWith("cancel_chatgpt_sign_in");
    await act(async () => rejectSignIn?.(new Error("Cancelled")));
  });
});
