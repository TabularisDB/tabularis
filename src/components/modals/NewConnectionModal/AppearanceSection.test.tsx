import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppearanceSection } from "./AppearanceSection";

// Mock react-i18next so the section renders predictably regardless of locale files
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
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
});
