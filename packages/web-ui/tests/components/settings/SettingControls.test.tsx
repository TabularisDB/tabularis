import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  SettingSection,
  SettingRow,
  SettingToggle,
  SettingButtonGroup,
  SettingSlider,
  SettingNumberInput,
} from "../../../src/components/settings/SettingControls";

describe("SettingSection", () => {
  it("renders title and children", () => {
    render(
      <SettingSection title="Test Section">
        <p>Section content</p>
      </SettingSection>,
    );
    expect(screen.getByText("Test Section")).toBeInTheDocument();
    expect(screen.getByText("Section content")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <SettingSection title="Title" description="Desc text">
        <span>child</span>
      </SettingSection>,
    );
    expect(screen.getByText("Desc text")).toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    render(
      <SettingSection title="Title" icon={<span data-testid="icon" />}>
        <span>child</span>
      </SettingSection>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("does not render description when absent", () => {
    const { container } = render(
      <SettingSection title="Title">
        <span>child</span>
      </SettingSection>,
    );
    const descriptions = container.querySelectorAll(".text-muted.mb-3");
    expect(descriptions.length).toBe(0);
  });
});

describe("SettingRow", () => {
  it("renders label and control in horizontal layout by default", () => {
    render(
      <SettingRow label="Row Label">
        <input data-testid="ctrl" />
      </SettingRow>,
    );
    expect(screen.getByText("Row Label")).toBeInTheDocument();
    expect(screen.getByTestId("ctrl")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <SettingRow label="Label" description="Help text">
        <span>ctrl</span>
      </SettingRow>,
    );
    expect(screen.getByText("Help text")).toBeInTheDocument();
  });

  it("renders vertical layout when vertical prop is true", () => {
    const { container } = render(
      <SettingRow label="Label" vertical>
        <span>ctrl</span>
      </SettingRow>,
    );
    // In vertical mode the outer div should not have flex items-center justify-between
    const outerDiv = container.firstChild as HTMLElement;
    expect(outerDiv.className).not.toContain("justify-between");
  });

  it("does not render description when absent", () => {
    render(
      <SettingRow label="Label">
        <span>ctrl</span>
      </SettingRow>,
    );
    const descElements = document.querySelectorAll(".text-muted");
    // Should not find a description element (only the label element exists)
    expect(
      Array.from(descElements).some((el) =>
        el.textContent?.includes("Help"),
      ),
    ).toBe(false);
  });
});

describe("SettingToggle", () => {
  it("renders as unchecked by default", () => {
    render(<SettingToggle checked={false} onChange={() => {}} />);
    const input = screen.getByRole("checkbox");
    expect(input).not.toBeChecked();
  });

  it("renders as checked when checked prop is true", () => {
    render(<SettingToggle checked={true} onChange={() => {}} />);
    const input = screen.getByRole("checkbox");
    expect(input).toBeChecked();
  });

  it("calls onChange with new value when clicked", () => {
    const onChange = vi.fn();
    render(<SettingToggle checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("calls onChange with false when unchecked", () => {
    const onChange = vi.fn();
    render(<SettingToggle checked={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("is disabled when disabled prop is true", () => {
    render(
      <SettingToggle checked={false} onChange={() => {}} disabled />,
    );
    const input = screen.getByRole("checkbox");
    expect(input).toBeDisabled();
  });

  it("applies cursor-not-allowed when disabled", () => {
    render(
      <SettingToggle checked={false} onChange={() => {}} disabled />,
    );
    const input = screen.getByRole("checkbox");
    const label = input.closest("label");
    expect(label).not.toBeNull();
    expect(label!.className).toContain("cursor-not-allowed");
  });
});

describe("SettingButtonGroup", () => {
  const options = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
    { value: "c", label: "Gamma" },
  ];

  it("renders all options", () => {
    render(
      <SettingButtonGroup value="a" onChange={() => {}} options={options} />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("highlights the selected option", () => {
    render(
      <SettingButtonGroup value="b" onChange={() => {}} options={options} />,
    );
    const selected = screen.getByText("Beta");
    expect(selected.className).toContain("bg-blue-600");
  });

  it("does not highlight unselected options", () => {
    render(
      <SettingButtonGroup value="b" onChange={() => {}} options={options} />,
    );
    const unselected = screen.getByText("Alpha");
    expect(unselected.className).not.toContain("bg-blue-600");
  });

  it("calls onChange with the clicked option value", () => {
    const onChange = vi.fn();
    render(
      <SettingButtonGroup value="a" onChange={onChange} options={options} />,
    );
    fireEvent.click(screen.getByText("Gamma"));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("works with numeric values", () => {
    const onChange = vi.fn();
    const numOptions = [
      { value: 2, label: "2" },
      { value: 4, label: "4" },
    ];
    render(
      <SettingButtonGroup value={2} onChange={onChange} options={numOptions} />,
    );
    fireEvent.click(screen.getByText("4"));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("applies mono font when mono prop is true", () => {
    render(
      <SettingButtonGroup
        value="a"
        onChange={() => {}}
        options={options}
        mono
      />,
    );
    const btn = screen.getByText("Alpha");
    expect(btn.className).toContain("font-mono");
  });
});

describe("SettingSlider", () => {
  it("renders with correct min, max, and value", () => {
    render(
      <SettingSlider
        value={14}
        onChange={() => {}}
        min={10}
        max={20}
        step={1}
      />,
    );
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("min", "10");
    expect(slider).toHaveAttribute("max", "20");
    expect(slider).toHaveValue("14");
  });

  it("displays the current value", () => {
    render(
      <SettingSlider
        value={16}
        onChange={() => {}}
        min={10}
        max={20}
        step={1}
      />,
    );
    expect(screen.getByText("16")).toBeInTheDocument();
  });

  it("uses formatValue when provided", () => {
    render(
      <SettingSlider
        value={14}
        onChange={() => {}}
        min={10}
        max={20}
        step={1}
        formatValue={(v) => `${v}px`}
      />,
    );
    expect(screen.getByText("14px")).toBeInTheDocument();
  });

  it("calls onChange with integer for step >= 1", () => {
    const onChange = vi.fn();
    render(
      <SettingSlider
        value={14}
        onChange={onChange}
        min={10}
        max={20}
        step={1}
      />,
    );
    fireEvent.change(screen.getByRole("slider"), {
      target: { value: "16" },
    });
    expect(onChange).toHaveBeenCalledWith(16);
  });

  it("calls onChange with float for step < 1", () => {
    const onChange = vi.fn();
    render(
      <SettingSlider
        value={1.5}
        onChange={onChange}
        min={1.0}
        max={2.5}
        step={0.1}
      />,
    );
    fireEvent.change(screen.getByRole("slider"), {
      target: { value: "1.8" },
    });
    expect(onChange).toHaveBeenCalledWith(1.8);
  });
});

describe("SettingNumberInput", () => {
  it("renders with the current value", () => {
    render(
      <SettingNumberInput value={500} onChange={() => {}} />,
    );
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(500);
  });

  it("renders suffix when provided", () => {
    render(
      <SettingNumberInput
        value={500}
        onChange={() => {}}
        suffix="rows"
      />,
    );
    expect(screen.getByText("rows")).toBeInTheDocument();
  });

  it("calls onChange with parsed integer", () => {
    const onChange = vi.fn();
    render(
      <SettingNumberInput value={500} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "1000" },
    });
    expect(onChange).toHaveBeenCalledWith(1000);
  });

  it("uses fallback for non-numeric input", () => {
    const onChange = vi.fn();
    render(
      <SettingNumberInput
        value={500}
        onChange={onChange}
        fallback={100}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it("uses 0 as default fallback", () => {
    const onChange = vi.fn();
    render(
      <SettingNumberInput value={500} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("respects min and max attributes", () => {
    render(
      <SettingNumberInput
        value={500}
        onChange={() => {}}
        min={100}
        max={10000}
      />,
    );
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("min", "100");
    expect(input).toHaveAttribute("max", "10000");
  });
});
