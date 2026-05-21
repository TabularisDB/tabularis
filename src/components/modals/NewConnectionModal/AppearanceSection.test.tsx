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

// Frimousse mock — avoids async data loading in JSDOM
vi.mock("frimousse", () => ({
  EmojiPicker: {
    Root: ({ children, onEmojiSelect }: { children: React.ReactNode; onEmojiSelect: (e: { emoji: string }) => void }) => (
      <div data-testid="emoji-root" onClick={() => onEmojiSelect({ emoji: "🐘" })}>
        {children}
      </div>
    ),
    Search: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Viewport: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    List: () => <div />,
    Loading: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Empty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
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

  it("resets icon when default tab is active and Reset is clicked", () => {
    const onChange = vi.fn();
    render(
      <AppearanceSection
        value={{ icon: { type: "emoji", value: "🐘" } }}
        onChange={onChange}
        connectionId="1"
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /default/i }));
    fireEvent.click(screen.getByRole("button", { name: /reset icon/i }));
    expect(onChange).toHaveBeenCalledWith({});
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

  // ── Frimousse emoji picker ──

  it("renders Frimousse emoji picker with search", () => {
    render(<AppearanceSection value={{}} onChange={() => {}} connectionId="1" />);
    fireEvent.click(screen.getByRole("tab", { name: /emoji/i }));
    expect(screen.getByLabelText(/emoji search/i)).toBeInTheDocument();
  });

  it("emits emoji icon when picker fires onEmojiSelect", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getByRole("tab", { name: /emoji/i }));
    // Clicking the root div triggers the mock onEmojiSelect({ emoji: "🐘" })
    fireEvent.click(screen.getByTestId("emoji-root"));
    expect(onChange).toHaveBeenCalledWith({ icon: { type: "emoji", value: "🐘" } });
  });

  // ── Icon search ──

  it("filters pack icons by search term", () => {
    render(<AppearanceSection value={{}} onChange={() => {}} connectionId="1" />);
    fireEvent.click(screen.getByRole("tab", { name: /pack/i }));
    const allInitial = screen.getAllByRole("button", { name: /^pick-/i });
    expect(allInitial.length).toBeGreaterThan(20);
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
});
