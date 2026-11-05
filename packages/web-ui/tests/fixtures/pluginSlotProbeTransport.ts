import { vi } from "vitest";

export const pluginSlotProbeContexts: Record<string, unknown>[] = [];

/** Test double for the iframe's MessagePort, recording plain context messages. */
export const connectFrameMock = vi.fn(async () => ({
  call: vi.fn(async (method: string, params: unknown[] = []) => {
    if (method === "slot.context" && params[0] && typeof params[0] === "object") {
      pluginSlotProbeContexts.push(params[0] as Record<string, unknown>);
    }
    return null;
  }),
  close: vi.fn(),
}));

export function resetPluginSlotProbe(): void {
  pluginSlotProbeContexts.length = 0;
}

export function getPluginProbeFrameModules(): Array<string | null> {
  return getPluginProbeFrames()
    .map((frame) => new URLSearchParams(frame.getAttribute("src")?.split("?")[1] ?? "").get("module"));
}

export function getPluginProbeFrames(): HTMLIFrameElement[] {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[title="Plugin context-probe"]'));
}
