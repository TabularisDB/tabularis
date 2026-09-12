import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { ResultToolbar } from "../../../src/components/notebook/ResultToolbar";
import { AlertContext } from "../../../src/contexts/AlertContext";
import type { AlertContextType } from "../../../src/contexts/AlertContext";
import type { QueryResult } from "../../../src/types/editor";

// Keep exports in memory; never call the native dialog or filesystem.
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn() }));

const mockSave = vi.mocked(save);
const mockWriteTextFile = vi.mocked(writeTextFile);
const showAlert = vi.fn<AlertContextType["showAlert"]>();

const result: QueryResult = {
  columns: ["id", "name", "active", "note"],
  rows: [
    [1, 'Ada, "Lovelace"', true, null],
    [2, "Grace\nHopper", false, ""],
  ],
  affected_rows: 0,
};

const formats = [
  {
    format: "csv",
    label: "CSV",
    output:
      'id,name,active,note\n1,"Ada, ""Lovelace""",true,\n2,"Grace\nHopper",false,',
  },
  {
    format: "json",
    label: "JSON",
    output: `[
  {
    "id": 1,
    "name": "Ada, \\"Lovelace\\"",
    "active": true,
    "note": null
  },
  {
    "id": 2,
    "name": "Grace\\nHopper",
    "active": false,
    "note": ""
  }
]`,
  },
] as const;

describe("ResultToolbar", () => {
  describe.each(formats)("$label export", ({ format, label, output }) => {
    const filePath = `/exports/result.${format}`;

    beforeEach(() => {
      mockSave.mockReset().mockResolvedValue(filePath);
      mockWriteTextFile.mockReset().mockResolvedValue(undefined);
      showAlert.mockReset();
      vi.spyOn(console, "error").mockImplementation(() => {});
      render(
        <AlertContext.Provider value={{ showAlert }}>
          <ResultToolbar result={result} executionTime={12.5} />
        </AlertContext.Provider>,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function clickExport() {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: label }));
      });
    }

    it("saves the exact serialized output and shows one success alert", async () => {
      await clickExport();

      expect(mockSave).toHaveBeenCalledExactlyOnceWith({
        defaultPath: `result.${format}`,
        filters: [{ name: label, extensions: [format] }],
      });
      expect(mockWriteTextFile).toHaveBeenCalledExactlyOnceWith(filePath, output);
      expect(showAlert).toHaveBeenCalledExactlyOnceWith(
        "editor.notebook.resultExportSuccess",
        { kind: "info" },
      );
      expect(console.error).not.toHaveBeenCalled();
    });

    it("silently cancels without writing or alerting", async () => {
      mockSave.mockResolvedValueOnce(null);

      await clickExport();

      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockWriteTextFile).not.toHaveBeenCalled();
      expect(showAlert).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it.each(["dialog", "write"] as const)(
      "shows only an error alert when the %s rejects",
      async (stage) => {
        const error = new Error(`${stage} rejected`);
        if (stage === "dialog") {
          mockSave.mockRejectedValueOnce(error);
        } else {
          mockWriteTextFile.mockRejectedValueOnce(error);
        }

        await clickExport();

        expect(mockSave).toHaveBeenCalledTimes(1);
        if (stage === "dialog") {
          expect(mockWriteTextFile).not.toHaveBeenCalled();
        } else {
          expect(mockWriteTextFile).toHaveBeenCalledExactlyOnceWith(filePath, output);
        }
        expect(showAlert).toHaveBeenCalledExactlyOnceWith(
          "editor.notebook.exportError",
          { kind: "error" },
        );
        expect(showAlert).not.toHaveBeenCalledWith(
          "editor.notebook.resultExportSuccess",
          { kind: "info" },
        );
        expect(console.error).toHaveBeenCalledExactlyOnceWith(
          `${label} export failed:`,
          error,
        );
      },
    );

    it("waits for the write to resolve before showing success", async () => {
      let resolveWrite!: () => void;
      const pendingWrite = new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });
      mockWriteTextFile.mockReturnValueOnce(pendingWrite);

      await clickExport();

      expect(mockWriteTextFile).toHaveBeenCalledExactlyOnceWith(filePath, output);
      expect(showAlert).not.toHaveBeenCalled();

      await act(async () => {
        resolveWrite();
        await pendingWrite;
      });

      expect(showAlert).toHaveBeenCalledExactlyOnceWith(
        "editor.notebook.resultExportSuccess",
        { kind: "info" },
      );
      expect(console.error).not.toHaveBeenCalled();
    });
  });
});