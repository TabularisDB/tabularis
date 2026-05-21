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

  it("validates custom hex input — rejects bad hex", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getByRole("button", { name: /custom color/i }));
    const input = screen.getByPlaceholderText("#rrggbb");
    fireEvent.change(input, { target: { value: "garbage" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("accepts valid custom hex on blur", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getByRole("button", { name: /custom color/i }));
    const input = screen.getByPlaceholderText("#rrggbb");
    fireEvent.change(input, { target: { value: "#abc123" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith({ accentColor: "#abc123" });
  });

  it("normalizes uppercase hex input to lowercase", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getByRole("button", { name: /custom color/i }));
    const input = screen.getByPlaceholderText("#rrggbb") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#ABC123" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith({ accentColor: "#abc123" });
    expect(input.value).toBe("#abc123");
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

  it("accepts a single emoji on blur", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getByRole("tab", { name: /emoji/i }));
    const input = screen.getByLabelText(/emoji input/i);
    fireEvent.change(input, { target: { value: "🐘" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith({ icon: { type: "emoji", value: "🐘" } });
  });

  it("rejects multi-grapheme emoji input", () => {
    const onChange = vi.fn();
    render(<AppearanceSection value={{}} onChange={onChange} connectionId="1" />);
    fireEvent.click(screen.getByRole("tab", { name: /emoji/i }));
    const input = screen.getByLabelText(/emoji input/i);
    fireEvent.change(input, { target: { value: "🐘🐘" } });
    fireEvent.blur(input);
    const errors = screen.queryAllByRole("alert");
    expect(errors.length).toBeGreaterThan(0);
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ icon: expect.anything() }));
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
});
