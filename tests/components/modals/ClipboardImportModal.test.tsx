import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClipboardImportModal } from "../../../src/components/modals/ClipboardImportModal";

const invokeMock = vi.mocked(invoke);
const translateMock = vi.hoisted(() => (key: string) => key);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translateMock }),
}));

// Use the real icons; the global setup mock only stubs a fixed subset.
vi.mock("lucide-react", async (importOriginal) => await importOriginal());

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(async () => "sku\tname\nKB-101\tMechanical Keyboard"),
}));

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => ({
    activeConnectionId: "c1",
    activeDriver: "postgres",
    activeSchema: "public",
  }),
}));

vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: {} }),
}));

vi.mock("../../../src/hooks/useDataTypes", () => ({
  useDataTypes: () => ({ dataTypes: [] }),
}));

const renderModal = (schema?: string) =>
  render(
    <ClipboardImportModal isOpen schema={schema} onClose={vi.fn()} onSuccess={vi.fn()} />,
  );

describe("ClipboardImportModal target schema", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command) =>
      command === "execute_clipboard_import" ? { rows_inserted: 1, table_created: true } : [],
    );
  });

  it.each([
    ["the schema it was opened for", "sales", "sales"],
    ["the active schema by default", undefined, "public"],
  ])("checks existing tables in %s", async (_label, schema, expected) => {
    renderModal(schema);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("get_tables", { connectionId: "c1", schema: expected }),
    );
  });

  it("imports into the schema it was opened for", async () => {
    renderModal("sales");

    fireEvent.change(await screen.findByPlaceholderText("clipboardImport.tableNamePlaceholder"), {
      target: { value: "new_arrivals" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "clipboardImport.import" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("execute_clipboard_import", {
        req: expect.objectContaining({ table_name: "new_arrivals", schema: "sales" }),
      }),
    );
  });
});
