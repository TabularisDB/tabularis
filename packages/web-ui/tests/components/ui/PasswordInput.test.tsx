import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PasswordInput } from "../../../src/components/ui/PasswordInput";

describe("PasswordInput", () => {
  it("masks the value by default and toggles reveal on click", () => {
    render(<PasswordInput value="secret" onChange={vi.fn()} aria-label="pw" />);

    const input = screen.getByLabelText("pw") as HTMLInputElement;
    expect(input.type).toBe("password");

    fireEvent.click(screen.getByLabelText("Show password"));
    expect(input.type).toBe("text");

    fireEvent.click(screen.getByLabelText("Hide password"));
    expect(input.type).toBe("password");
  });

  it("propagates typed input through onChange", () => {
    const onChange = vi.fn();
    render(<PasswordInput value="" onChange={onChange} aria-label="pw" />);

    fireEvent.change(screen.getByLabelText("pw"), { target: { value: "hunter2" } });
    expect(onChange).toHaveBeenCalledWith("hunter2");
  });

  it("keeps the reveal toggle out of the tab order", () => {
    render(<PasswordInput value="" onChange={vi.fn()} aria-label="pw" />);
    expect(screen.getByLabelText("Show password")).toHaveAttribute("tabindex", "-1");
  });
});
