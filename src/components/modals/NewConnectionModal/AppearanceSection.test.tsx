import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AppearanceSection } from "./AppearanceSection";

// Mock react-i18next so the section renders predictably regardless of locale files
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue("/tmp/picked.png"),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("connection-icons/1-abcd.png"),
  convertFileSrc: (s: string) => `tauri://${s}`,
}));

// emoji-picker-react mock — avoids heavy DOM in JSDOM
vi.mock("emoji-picker-react", () => ({
  default: ({ onEmojiClick }: { onEmojiClick: (e: { emoji: string }) => void }) => (
    <div data-testid="emoji-picker" onClick={() => onEmojiClick({ emoji: "🐘" })}>
      <input aria-label="emoji search" />
    </div>
  ),
  Theme: { DARK: "dark", LIGHT: "light", AUTO: "auto" },
  EmojiStyle: { NATIVE: "native", APPLE: "apple", GOOGLE: "google", TWITTER: "twitter", FACEBOOK: "facebook" },
  SuggestionMode: { RECENT: "recent", FREQUENT: "frequent" },
  SkinTonePickerLocation: { SEARCH: "search", PREVIEW: "preview" },
}));

describe("AppearanceSection — color", () => {
  it("renders 12 swatches", () => {
    render(<AppearanceSection value={{}} onChange={() => {}} connectionId="1" />);
    expect(screen.getAllByRole("button", { name: /color swatch/i })).toHaveLength(12);
  });

  it("emits accentColor on swatch click", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getAllByRole("button", { name: /color swatch/i })[0]);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      accentColor: expect.stringMatching(/^#[0-9a-f]{6}$/i),
    }));
  });

  it("clears appearance entirely when reset on color-only state", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{ accentColor: "#ff0000" }} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getByRole("button", { name: /reset color/i }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("keeps icon when only color is reset", () => {
    const onChange = vi.fn();
    render(
      <AppearanceSection
        value={{ accentColor: "#ff0000", icon: { type: "pack", id: "server" } }}
        onChange={onChange}
        connectionId="1"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /reset color/i }));
    expect(onChange).toHaveBeenCalledWith({ icon: { type: "pack", id: "server" } });
  });

  it("opens the custom panel with hex input + picker", () => {
    render(<AppearanceSection value={{}} onChange={() => {}} connectionId="1" />);
    fireEvent.click(screen.getByRole("button", { name: /custom color/i }));
    expect(screen.getByLabelText(/custom hex input/i)).toBeInTheDocument();
  });

  it("emits accentColor when valid hex is typed into the input", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getByRole("button", { name: /custom color/i }));
    const input = screen.getByLabelText(/custom hex input/i);
    fireEvent.change(input, { target: { value: "abc123" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ accentColor: "#abc123" }));
  });

  it("filters non-hex characters from input (react-colorful behavior)", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getByRole("button", { name: /custom color/i }));
    const input = screen.getByLabelText(/custom hex input/i);
    fireEvent.change(input, { target: { value: "garbage" } });
    // react-colorful keeps only hex chars: "garbage" → "abae" → truncated to 3 (valid short hex)
    // Verify: no call ever stored the raw "garbage" string
    const rawCalls = onChange.mock.calls.filter(c => c[0].accentColor === "garbage");
    expect(rawCalls).toHaveLength(0);
    // If a call WAS made, it must be a valid 3-char or 6-char hex prefixed with #
    for (const [arg] of onChange.mock.calls) {
      if (arg.accentColor) {
        expect(arg.accentColor).toMatch(/^#[0-9a-f]{3}([0-9a-f]{3})?$/i);
      }
    }
  });
});

describe("AppearanceSection — icon tabs", () => {
  it("renders 4 tabs", () => {
    render(<AppearanceSection value={{}} onChange={() => {}} connectionId="1" />);
    expect(screen.getByRole("tab", { name: /default/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /pack/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /emoji/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /image/i })).toBeInTheDocument();
  });

  it("picks a pack icon and emits IconOverride", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getByRole("tab", { name: /pack/i }));
    fireEvent.click(screen.getByRole("button", { name: "pick-server" }));
    expect(onChange).toHaveBeenCalledWith({ icon: { type: "pack", id: "server" } });
  });

  it("clears the icon override when the Default tab is clicked", () => {
    const onChange = vi.fn();
    render(
      <AppearanceSection
        value={{ icon: { type: "emoji", value: "🐘" } }}
        onChange={onChange}
        connectionId="1"
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /default/i }));
    // Clicking the Default tab is itself the reset action — no extra button click needed.
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("does not call onChange when Default tab is clicked with no existing override", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getByRole("tab", { name: /default/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uploads an image and stores the returned path", async () => {
    const onChange = vi.fn();
    const { invoke } = await import("@tauri-apps/api/core");
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="conn1" />);
    fireEvent.click(screen.getByRole("tab", { name: /image/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose image/i }));
    // Wait for the async upload to resolve
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_connection_icon", {
        connectionId: "conn1",
        sourcePath: "/tmp/picked.png",
      });
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        icon: { type: "image", path: "connection-icons/1-abcd.png" },
      });
    });
  });

  it("does not eagerly delete previous image on pick", async () => {
    const onChange = vi.fn();
    const onImageUploaded = vi.fn();
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    render(
      <AppearanceSection
        value={{ icon: { type: "image", path: "connection-icons/old-1234.png" } }}
        onChange={onChange}
        connectionId="conn1"
        onImageUploaded={onImageUploaded}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /image/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose image/i }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_connection_icon", expect.any(Object));
    });
    // The previous image must NOT be deleted as part of the pick
    const deleteCalls = vi.mocked(invoke).mock.calls.filter(c => c[0] === "delete_connection_icon");
    expect(deleteCalls).toHaveLength(0);
    // onImageUploaded callback should have been called with the new path
    expect(onImageUploaded).toHaveBeenCalledWith("connection-icons/1-abcd.png");
  });

  // ── emoji-picker-react emoji picker ──

  it("renders emoji picker with search", () => {
    render(<AppearanceSection value={{}} onChange={() => {}} connectionId="1" />);
    fireEvent.click(screen.getByRole("tab", { name: /emoji/i }));
    expect(screen.getByTestId("emoji-picker")).toBeInTheDocument();
    expect(screen.getByLabelText(/emoji search/i)).toBeInTheDocument();
  });

  it("emits emoji icon when picker fires onEmojiClick", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getByRole("tab", { name: /emoji/i }));
    // Clicking the picker div triggers the mock onEmojiClick({ emoji: "🐘" })
    fireEvent.click(screen.getByTestId("emoji-picker"));
    expect(onChange).toHaveBeenCalledWith({ icon: { type: "emoji", value: "🐘" } });
  });

  // ── Icon search ──

  it("filters pack icons by search term", () => {
    render(<AppearanceSection value={{}} onChange={() => {}} connectionId="1" />);
    fireEvent.click(screen.getByRole("tab", { name: /pack/i }));
    const allInitial = screen.getAllByRole("button", { name: /^pick-/i });
    // The mocked dynamicIconImports has 5 icons (all shown since < RESULT_LIMIT of 120)
    expect(allInitial.length).toBeGreaterThan(0);
    const search = screen.getByLabelText(/icon search/i);
    fireEvent.change(search, { target: { value: "shield" } });
    const filtered = screen.getAllByRole("button", { name: /^pick-/i });
    expect(filtered.length).toBeLessThan(allInitial.length);
    expect(filtered.length).toBeGreaterThan(0);
  });

  // ── Tab sync (edit mode) ──

  it("switches to matching tab when value.icon changes externally (edit mode)", () => {
    const { rerender } = render(
      <AppearanceSection value={{}} onChange={() => {}} connectionId="1" />
    );
    expect(screen.getByRole("tab", { name: /default/i })).toHaveAttribute("aria-selected", "true");
    rerender(
      <AppearanceSection
        value={{ icon: { type: "pack", id: "server" } }}
        onChange={() => {}}
        connectionId="1"
      />
    );
    expect(screen.getByRole("tab", { name: /pack/i })).toHaveAttribute("aria-selected", "true");
  });

  it("resets to derived tab when value.icon type changes externally after a user click", () => {
    const { rerender } = render(
      <AppearanceSection value={{}} onChange={() => {}} connectionId="1" />
    );
    // User explicitly clicks emoji tab
    fireEvent.click(screen.getByRole("tab", { name: /emoji/i }));
    expect(screen.getByRole("tab", { name: /emoji/i })).toHaveAttribute("aria-selected", "true");
    // External change: parent sets a pack icon (different type)
    rerender(
      <AppearanceSection
        value={{ icon: { type: "pack", id: "server" } }}
        onChange={() => {}}
        connectionId="1"
      />
    );
    // Tab must follow the new icon type, not stay stuck on the user's previous choice
    expect(screen.getByRole("tab", { name: /pack/i })).toHaveAttribute("aria-selected", "true");
  });
});
