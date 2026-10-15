import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectionHealthMonitor } from "../../src/components/ConnectionHealthMonitor";

const mocks = vi.hoisted(() => ({
  client: { subscribe: vi.fn() },
  showAlert: vi.fn(),
  navigate: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("../../src/hooks/useTabularisClient", () => ({ useTabularisClient: () => mocks.client }));
vi.mock("../../src/hooks/useAlert", () => ({ useAlert: () => ({ showAlert: mocks.showAlert }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));

describe("ConnectionHealthMonitor transport events", () => {
  it("shows health failures from the active client and unsubscribes on unmount", async () => {
    const unsubscribe = vi.fn();
    mocks.client.subscribe.mockResolvedValue(unsubscribe);
    const view = render(<ConnectionHealthMonitor />);
    expect(mocks.client.subscribe).toHaveBeenCalledWith("connection-health-failed", expect.any(Function));
    const handler = mocks.client.subscribe.mock.calls[0][1];
    act(() => handler({ connectionId: "c1", error: "connection closed" }));
    expect(mocks.showAlert).toHaveBeenCalledWith("healthCheck.connectionLost: connection closed", expect.objectContaining({ kind: "error" }));
    await act(async () => { view.unmount(); });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
