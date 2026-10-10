import { describe, expect, it, vi } from "vitest";
import type { PlatformCapabilities } from "../../src/platform/capabilities";
import type { NotebookState } from "../../src/types/notebook";
import {
  chooseNotebookImport,
  downloadNotebook,
  downloadNotebookHtml,
} from "../../src/utils/notebookTransfer";

const state: NotebookState = {
  cells: [
    {
      id: "cell-1",
      type: "sql",
      content: "SELECT 42 AS answer",
      name: "Answer",
      chartConfig: {
        type: "bar",
        labelColumn: "answer",
        valueColumns: ["answer"],
      },
    },
    { id: "cell-2", type: "markdown", content: "# Results" },
  ],
  params: [{ name: "region", value: "eu" }],
  stopOnError: true,
};

function platformFixture(overrides: Partial<PlatformCapabilities>): PlatformCapabilities {
  return overrides as PlatformCapabilities;
}

describe("notebookTransfer", () => {
  it("imports the desktop-compatible notebook format through an opaque reference", async () => {
    const contents = new TextEncoder().encode(
      JSON.stringify({
        version: 2,
        title: "Imported",
        createdAt: "2026-08-22T00:00:00Z",
        cells: [
          {
            type: "sql",
            content: "SELECT 42 AS answer",
            name: "Answer",
            chartConfig: state.cells[0].chartConfig,
          },
        ],
        params: state.params,
        stopOnError: true,
      }),
    );
    const chooseInputFile = vi.fn().mockResolvedValue({
      name: "import.tabularis-notebook",
      reference: "opaque-browser-file",
    });
    const readInputFile = vi.fn().mockResolvedValue(contents);

    await expect(
      chooseNotebookImport(platformFixture({ chooseInputFile, readInputFile })),
    ).resolves.toMatchObject({
      title: "Imported",
      state: {
        stopOnError: true,
        params: state.params,
        cells: [
          {
            type: "sql",
            content: "SELECT 42 AS answer",
            name: "Answer",
            chartConfig: state.cells[0].chartConfig,
          },
        ],
      },
    });
    expect(readInputFile).toHaveBeenCalledWith("opaque-browser-file");
  });

  it("exports notebook JSON through the platform download adapter", async () => {
    const downloadFile = vi.fn().mockResolvedValue(true);

    await expect(
      downloadNotebook(platformFixture({ downloadFile }), "Revenue / 2026", state),
    ).resolves.toBe(true);

    const request = downloadFile.mock.calls[0][0];
    expect(request.fileName).toBe("Revenue___2026.tabularis-notebook");
    expect(request.mimeType).toBe("application/json");
    expect(JSON.parse(new TextDecoder().decode(request.contents))).toMatchObject({
      version: 2,
      title: "Revenue / 2026",
      stopOnError: true,
      params: state.params,
      cells: [
        {
          type: "sql",
          content: "SELECT 42 AS answer",
          chartConfig: state.cells[0].chartConfig,
        },
        { type: "markdown", content: "# Results" },
      ],
    });
  });

  it("preserves HTML export through the same browser-safe download adapter", async () => {
    const downloadFile = vi.fn().mockResolvedValue(true);

    await downloadNotebookHtml(
      platformFixture({ downloadFile }),
      "Revenue",
      state,
    );

    const request = downloadFile.mock.calls[0][0];
    expect(request.fileName).toBe("Revenue.html");
    expect(request.mimeType).toBe("text/html;charset=utf-8");
    const html = new TextDecoder().decode(request.contents);
    expect(html).toContain("Revenue");
    expect(html).toContain("SELECT 42 AS answer");
    expect(html).toContain("Results");
  });
});
