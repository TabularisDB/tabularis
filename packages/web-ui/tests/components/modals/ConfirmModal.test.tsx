import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ConfirmModal } from "../../../src/components/modals/ConfirmModal";

// Mock the Modal component to just render children when open
vi.mock("../../../src/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
  }) => (isOpen ? <div data-testid="modal">{children}</div> : null),
}));

describe("ConfirmModal", () => {
  const mockOnConfirm = vi.fn();
  const mockOnClose = vi.fn();

  const renderModal = (props: Partial<React.ComponentProps<typeof ConfirmModal>> = {}) =>
    render(
      <ConfirmModal
        isOpen
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        title="Danger"
        message="This is destructive"
        confirmLabel="Run anyway"
        {...props}
      />,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("confirms immediately when no delay is set", () => {
    renderModal();
    const button = screen.getByRole("button", { name: "Run anyway" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables the confirm button and counts down when a delay is set", () => {
    renderModal({ confirmDelaySeconds: 3 });

    // Starts disabled with the initial countdown value.
    let button = screen.getByRole("button", { name: /Run anyway \(3\)/ });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(mockOnConfirm).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("button", { name: /Run anyway \(2\)/ })).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Countdown finished: label loses the counter and the button is enabled.
    button = screen.getByRole("button", { name: "Run anyway" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
  });

  it("restarts the countdown each time the modal reopens", () => {
    const { rerender } = renderModal({ confirmDelaySeconds: 3 });

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("button", { name: "Run anyway" })).not.toBeDisabled();

    // Close and reopen: countdown should reset.
    rerender(
      <ConfirmModal
        isOpen={false}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        title="Danger"
        message="This is destructive"
        confirmLabel="Run anyway"
        confirmDelaySeconds={3}
      />,
    );
    rerender(
      <ConfirmModal
        isOpen
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        title="Danger"
        message="This is destructive"
        confirmLabel="Run anyway"
        confirmDelaySeconds={3}
      />,
    );

    expect(screen.getByRole("button", { name: /Run anyway \(3\)/ })).toBeDisabled();
  });
});
