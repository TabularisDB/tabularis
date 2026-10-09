import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "../../../src/components/ui/Select";

describe("Select", () => {
  it("names the trigger and selects a labeled option", () => {
    const onChange = vi.fn();
    render(
      <Select
        ariaLabel="Connection string example"
        value={null}
        options={["mysql://localhost/shop"]}
        labels={{ "mysql://localhost/shop": "Local MySQL" }}
        placeholder="Choose an example"
        searchable={false}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Connection string example",
    });
    expect(trigger).toHaveTextContent("Choose an example");
    expect(trigger).toHaveClass("focus-visible:outline-focus");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Local MySQL" }));
    expect(onChange).toHaveBeenCalledWith("mysql://localhost/shop");
  });
});
