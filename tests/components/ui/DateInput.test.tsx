import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateInput } from "../../../src/components/ui/DateInput";

describe("DateInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 27, 15, 30, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits the prefilled date of an empty value via onCommitValue", () => {
    const onChange = vi.fn();
    const onCommitValue = vi.fn();
    render(
      <DateInput
        value=""
        mode="date"
        onChange={onChange}
        onCommitValue={onCommitValue}
      />,
    );

    fireEvent.click(screen.getByText("dateInput.useShownValue"));
    expect(onCommitValue).toHaveBeenCalledWith("2026-09-27");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to onChange when no commit handler is given", () => {
    const onChange = vi.fn();
    render(<DateInput value="" mode="datetime" onChange={onChange} />);

    fireEvent.click(screen.getByText("dateInput.useShownValue"));
    expect(onChange).toHaveBeenCalledWith("2026-09-27 00:00:00");
  });

  it("commits the prefilled date on Enter and still forwards the key", () => {
    const onCommitValue = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <DateInput
        value=""
        mode="date"
        onChange={vi.fn()}
        onCommitValue={onCommitValue}
        onKeyDown={onKeyDown}
      />,
    );

    fireEvent.keyDown(screen.getAllByRole("combobox")[0], { key: "Enter" });
    expect(onCommitValue).toHaveBeenCalledWith("2026-09-27");
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("does not offer or auto-commit the shown value once a value is set", () => {
    const onCommitValue = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <DateInput
        value="2020-01-15"
        mode="date"
        onChange={vi.fn()}
        onCommitValue={onCommitValue}
        onKeyDown={onKeyDown}
      />,
    );

    expect(screen.queryByText("dateInput.useShownValue")).toBeNull();
    fireEvent.keyDown(screen.getAllByRole("combobox")[0], { key: "Enter" });
    expect(onCommitValue).not.toHaveBeenCalled();
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});
