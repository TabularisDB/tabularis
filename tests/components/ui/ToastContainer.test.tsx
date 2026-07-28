import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { ToastContainer, type ToastItem } from "../../../src/components/ui/ToastContainer";
import { ToastProvider } from "../../../src/contexts/ToastProvider";
import { useToast } from "../../../src/hooks/useToast";
import type { ToastOptions } from "../../../src/contexts/ToastContext";

const Trigger = ({ message, options }: { message: string; options?: ToastOptions }) => {
  const { showToast } = useToast();
  return <button onClick={() => showToast(message, options)}>trigger</button>;
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ToastContainer", () => {
  it("renders nothing when there are no toasts", () => {
    const { container } = render(<ToastContainer toasts={[]} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders title and message", () => {
    const toasts: ToastItem[] = [
      { id: 1, title: "Selection updated", message: "vins was removed", kind: "warning" },
    ];
    render(<ToastContainer toasts={toasts} onDismiss={() => {}} />);
    expect(screen.getByText("Selection updated")).toBeInTheDocument();
    expect(screen.getByText("vins was removed")).toBeInTheDocument();
  });

  it("renders a toast without a title", () => {
    const toasts: ToastItem[] = [{ id: 1, message: "plain message", kind: "info" }];
    render(<ToastContainer toasts={toasts} onDismiss={() => {}} />);
    expect(screen.getByText("plain message")).toBeInTheDocument();
  });

  it("calls onDismiss with the toast id when the close button is clicked", () => {
    const onDismiss = vi.fn();
    const toasts: ToastItem[] = [{ id: 7, message: "bye", kind: "error" }];
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onDismiss).toHaveBeenCalledWith(7);
  });

  it("stacks multiple toasts", () => {
    const toasts: ToastItem[] = [
      { id: 1, message: "first", kind: "info" },
      { id: 2, message: "second", kind: "success" },
    ];
    render(<ToastContainer toasts={toasts} onDismiss={() => {}} />);
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });
});

describe("ToastProvider", () => {
  it("shows a toast when showToast is called", () => {
    render(
      <ToastProvider>
        <Trigger message="hello" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("trigger"));
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("auto-dismisses a toast after the default duration", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger message="ephemeral" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("trigger"));
    expect(screen.getByText("ephemeral")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText("ephemeral")).not.toBeInTheDocument();
  });

  it("keeps a toast with duration 0 until it is dismissed manually", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger message="sticky" options={{ duration: 0 }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("trigger"));
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByText("sticky")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("common.close"));
    expect(screen.queryByText("sticky")).not.toBeInTheDocument();
  });

  it("dismissing one toast keeps the others visible", () => {
    render(
      <ToastProvider>
        <Trigger message="first" options={{ duration: 0 }} />
      </ToastProvider>,
    );
    const trigger = screen.getByText("trigger");
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    const closeButtons = screen.getAllByLabelText("common.close");
    expect(closeButtons).toHaveLength(2);
    fireEvent.click(closeButtons[0]);
    expect(screen.getAllByLabelText("common.close")).toHaveLength(1);
  });
});
