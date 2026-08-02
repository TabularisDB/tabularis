import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiQueryModal } from "../../../src/components/modals/AiQueryModal";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({
    activeConnectionId: "active-connection",
    activeSchema: "public",
  }),
}));

vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      aiProvider: "custom-openai",
      aiModel: "test-model",
    },
  }),
}));

vi.mock("../../../src/components/ui/Modal", () => ({
  Modal: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
  }) => (isOpen ? <div>{children}</div> : null),
}));

describe("AiQueryModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("waits for the driver schema context before generating SQL", async () => {
    let resolveSchema: ((value: string) => void) | undefined;
    const schemaPromise = new Promise<string>((resolve) => {
      resolveSchema = resolve;
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_ai_schema_context") return schemaPromise;
      if (command === "generate_ai_query") return Promise.resolve("SELECT 1");
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const onInsert = vi.fn();

    render(
      <AiQueryModal
        isOpen
        onClose={vi.fn()}
        onInsert={onInsert}
        connectionId="plugin-connection"
        schema="analytics"
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText(/Find all users/i),
      { target: { value: "Count users" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Generate SQL/i }));

    expect(
      invokeMock.mock.calls.filter(([command]) => command === "generate_ai_query"),
    ).toHaveLength(0);

    resolveSchema?.('Table: "users"\n  - id bigint PK NOT NULL');

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("generate_ai_query", {
        req: {
          provider: "custom-openai",
          model: "test-model",
          prompt: "Count users",
          schema: 'Table: "users"\n  - id bigint PK NOT NULL',
        },
      });
    });
    expect(onInsert).toHaveBeenCalledWith("SELECT 1");
  });

  it("loads schema context for the connection and schema passed by the caller", async () => {
    invokeMock.mockResolvedValue("");

    render(
      <AiQueryModal
        isOpen
        onClose={vi.fn()}
        onInsert={vi.fn()}
        connectionId="plugin-connection"
        schema="warehouse"
      />,
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_ai_schema_context", {
        connectionId: "plugin-connection",
        schema: "warehouse",
      });
    });
  });
});
