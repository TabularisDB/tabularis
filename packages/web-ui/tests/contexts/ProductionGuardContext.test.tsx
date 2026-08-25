import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContext, type ReactNode } from "react";
import { ProductionGuardProvider } from "../../src/contexts/ProductionGuardContext";
import { ProductionGuardContext } from "../../src/hooks/useProductionGuard";

const settingsState = vi.hoisted(() => ({ delayEnabled: false }));

vi.mock("../../src/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      safetyConfirmationDelayEnabled: settingsState.delayEnabled,
    },
  }),
}));

vi.mock("lucide-react", () => ({
  TriangleAlert: () => <span data-testid="warning-icon" />,
  X: () => <span data-testid="close-icon" />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "environment.warnConfirm" ? "Run anyway" : key,
  }),
}));

vi.mock("../../src/components/ui/SqlPreview", () => ({
  SqlPreview: () => <div data-testid="sql-preview" />,
}));

vi.mock("../../src/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: ReactNode;
  }) => (isOpen ? <div>{children}</div> : null),
}));

function GuardRequester() {
  const request = useContext(ProductionGuardContext);

  return (
    <button
      onClick={() => {
        void request?.("prod-id", "Production", "DROP TABLE users");
      }}
    >
      Request confirmation
    </button>
  );
}

describe("ProductionGuardProvider", () => {
  beforeEach(() => {
    settingsState.delayEnabled = false;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows immediate confirmation when the safety delay is disabled", () => {
    render(
      <ProductionGuardProvider>
        <GuardRequester />
      </ProductionGuardProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Request confirmation" }));

    expect(screen.getByRole("button", { name: "Run anyway" })).not.toBeDisabled();
  });

  it("counts down production confirmation when the safety delay is enabled", () => {
    settingsState.delayEnabled = true;
    render(
      <ProductionGuardProvider>
        <GuardRequester />
      </ProductionGuardProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Request confirmation" }));
    expect(screen.getByRole("button", { name: "Run anyway (5)" })).toBeDisabled();

    for (let second = 0; second < 5; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }

    expect(screen.getByRole("button", { name: "Run anyway" })).not.toBeDisabled();
  });
});
