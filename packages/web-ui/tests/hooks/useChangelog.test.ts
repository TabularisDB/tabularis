import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useChangelog } from "../../src/hooks/useChangelog";

afterEach(() => vi.unstubAllGlobals());

it("fetches only when requested and aborts an outstanding request on close", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "# Changelog\n\n## [1.0.0]\n\n- First release\n" });
  vi.stubGlobal("fetch", fetchMock);
  const { result, rerender, unmount } = renderHook(({ enabled }) => useChangelog(enabled), { initialProps: { enabled: false } });
  expect(fetchMock).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  unmount();
  expect(signal.aborted).toBe(true);
});
