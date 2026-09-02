import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopyFeedback } from "../../src/hooks/useCopyFeedback";

const mockWriteText = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: mockWriteText },
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useCopyFeedback", () => {
  it("starts with copied = false", () => {
    const { result } = renderHook(() => useCopyFeedback());
    expect(result.current.copied).toBe(false);
  });

  it("sets copied to true immediately after a successful copy", async () => {
    mockWriteText.mockResolvedValue(undefined);
    const { result } = renderHook(() => useCopyFeedback());

    await act(async () => {
      await result.current.copy("hello");
    });

    expect(result.current.copied).toBe(true);
  });

  it("resets copied to false after resetMs", async () => {
    mockWriteText.mockResolvedValue(undefined);
    const { result } = renderHook(() => useCopyFeedback(1000));

    await act(async () => {
      await result.current.copy("hello");
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copied).toBe(false);
  });

  it("restarts the timer on rapid successive copies", async () => {
    mockWriteText.mockResolvedValue(undefined);
    const { result } = renderHook(() => useCopyFeedback(1000));

    await act(async () => {
      await result.current.copy("first");
    });

    act(() => {
      vi.advanceTimersByTime(600);
    });

    await act(async () => {
      await result.current.copy("second");
    });

    // 600 ms after the second copy — timer should not have fired yet
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.copied).toBe(true);

    // Full 1000 ms after the second copy — now it resets
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.copied).toBe(false);
  });

  it("does not set copied and logs an error when the clipboard rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWriteText.mockRejectedValue(new Error("permission denied"));
    const { result } = renderHook(() => useCopyFeedback());

    await act(async () => {
      await result.current.copy("hello");
    });

    expect(result.current.copied).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to copy to clipboard:",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("clears the timer on unmount so setState is never called after unmount", async () => {
    mockWriteText.mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useCopyFeedback(1000));

    await act(async () => {
      await result.current.copy("hello");
    });

    unmount();

    // Advancing time after unmount must not throw a setState-on-unmounted warning
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }).not.toThrow();
  });
});
