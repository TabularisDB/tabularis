import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseExplain, type ExplainPlan } from "@tabularis/explain";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { VisualExplainView } from "../../../src/components/explain/VisualExplainView";
import { AlertContext } from "../../../src/contexts/AlertContext";
import type { AlertContextType } from "../../../src/contexts/AlertContext";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn() }));
vi.mock("lucide-react", () => vi.importActual("lucide-react"));

vi.mock("../../../src/themes/themeUtils", () => ({
  loadMonacoTheme: vi.fn(),
}));

vi.mock("../../../src/themes/themeRuntime", () => ({
  getMonacoThemeId: vi.fn().mockReturnValue("vs-dark"),
}));

vi.mock("../../../src/hooks/useEditorTheme", () => ({
  useEditorTheme: () => ({ id: "dark" }),
}));

vi.mock("../../../src/components/ui/LazyMonaco", () => ({
  MonacoEditor: ({ value, language }: { value: string; language: string }) => (
    <div data-testid="monaco-editor" data-language={language}>
      {value}
    </div>
  ),
}));

const mockSave = vi.mocked(save);
const mockWriteTextFile = vi.mocked(writeTextFile);
const showAlert = vi.fn<AlertContextType["showAlert"]>();

function createTestPlan(rawOutput?: string): ExplainPlan {
  const plan = parseExplain('[{"Plan":{"Node Type":"Seq Scan","Relation Name":"users"}}]');
  return {
    ...plan,
    raw_output: rawOutput,
  };
}

describe("VisualExplainView raw plan save", () => {
  beforeEach(() => {
    mockSave.mockReset();
    mockWriteTextFile.mockReset();
    showAlert.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders Save raw plan button and disables it when raw_output is absent", () => {
    const plan = createTestPlan(undefined);
    render(
      <AlertContext.Provider value={{ showAlert }}>
        <VisualExplainView
          plan={plan}
          isLoading={false}
          error={null}
          viewMode="raw"
          onViewModeChange={vi.fn()}
          selectedNodeId={null}
          onSelectNode={vi.fn()}
          aiEnabled={false}
        />
      </AlertContext.Provider>,
    );

    const button = screen.getByRole("button", {
      name: "editor.visualExplain.saveRawPlan",
    });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(screen.getByText("editor.visualExplain.noRawOutput")).toBeInTheDocument();
  });

  it("enables button and writes original raw content when dialog succeeds", async () => {
    const rawContent = '{"query_block":{"cost":42}}';
    const plan = createTestPlan(rawContent);
    mockSave.mockResolvedValue("/path/to/plan.json");
    mockWriteTextFile.mockResolvedValue(undefined);

    render(
      <AlertContext.Provider value={{ showAlert }}>
        <VisualExplainView
          plan={plan}
          isLoading={false}
          error={null}
          viewMode="raw"
          onViewModeChange={vi.fn()}
          selectedNodeId={null}
          onSelectNode={vi.fn()}
          aiEnabled={false}
        />
      </AlertContext.Provider>,
    );

    const button = screen.getByRole("button", {
      name: "editor.visualExplain.saveRawPlan",
    });
    expect(button).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockSave).toHaveBeenCalledWith({
      defaultPath: "explain.json",
      filters: [
        { name: "JSON", extensions: ["json"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    expect(mockWriteTextFile).toHaveBeenCalledWith("/path/to/plan.json", rawContent);
    expect(showAlert).toHaveBeenCalledWith("editor.visualExplain.rawExported", {
      kind: "info",
    });
  });

  it("captures plan snapshot before awaiting dialog so later plan replacement does not alter saved content", async () => {
    const initialRaw = '{"plan": "initial"}';
    const initialPlan = createTestPlan(initialRaw);

    let resolveSave!: (path: string | null) => void;
    mockSave.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    mockWriteTextFile.mockResolvedValue(undefined);

    const { rerender } = render(
      <AlertContext.Provider value={{ showAlert }}>
        <VisualExplainView
          plan={initialPlan}
          isLoading={false}
          error={null}
          viewMode="raw"
          onViewModeChange={vi.fn()}
          selectedNodeId={null}
          onSelectNode={vi.fn()}
          aiEnabled={false}
        />
      </AlertContext.Provider>,
    );

    const button = screen.getByRole("button", {
      name: "editor.visualExplain.saveRawPlan",
    });

    // Start saving: click begins awaiting the dialog
    act(() => {
      fireEvent.click(button);
    });

    // While awaiting dialog, the parent rerenders with a new plan
    const updatedPlan = createTestPlan('{"plan": "replaced_by_new_query"}');
    rerender(
      <AlertContext.Provider value={{ showAlert }}>
        <VisualExplainView
          plan={updatedPlan}
          isLoading={false}
          error={null}
          viewMode="raw"
          onViewModeChange={vi.fn()}
          selectedNodeId={null}
          onSelectNode={vi.fn()}
          aiEnabled={false}
        />
      </AlertContext.Provider>,
    );

    // Resolve the dialog picker
    await act(async () => {
      resolveSave("/path/to/exported.json");
    });

    // Must have saved the initial captured raw content, NOT the new plan's content
    expect(mockWriteTextFile).toHaveBeenCalledWith(
      "/path/to/exported.json",
      initialRaw,
    );
    expect(showAlert).toHaveBeenCalledWith("editor.visualExplain.rawExported", {
      kind: "info",
    });
  });

  it("handles dialog cancellation cleanly without writing or alerting", async () => {
    const rawContent = "Seq Scan on users (cost=0.00..10.00)";
    const plan = createTestPlan(rawContent);
    mockSave.mockResolvedValue(null);

    render(
      <AlertContext.Provider value={{ showAlert }}>
        <VisualExplainView
          plan={plan}
          isLoading={false}
          error={null}
          viewMode="raw"
          onViewModeChange={vi.fn()}
          selectedNodeId={null}
          onSelectNode={vi.fn()}
          aiEnabled={false}
        />
      </AlertContext.Provider>,
    );

    const button = screen.getByRole("button", {
      name: "editor.visualExplain.saveRawPlan",
    });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockSave).toHaveBeenCalled();
    expect(mockWriteTextFile).not.toHaveBeenCalled();
    expect(showAlert).not.toHaveBeenCalled();
  });

  it("handles write failure by logging error and showing error alert", async () => {
    const rawContent = '{"cost": 100}';
    const plan = createTestPlan(rawContent);
    mockSave.mockResolvedValue("/path/to/file.json");
    mockWriteTextFile.mockRejectedValue(new Error("disk full"));

    render(
      <AlertContext.Provider value={{ showAlert }}>
        <VisualExplainView
          plan={plan}
          isLoading={false}
          error={null}
          viewMode="raw"
          onViewModeChange={vi.fn()}
          selectedNodeId={null}
          onSelectNode={vi.fn()}
          aiEnabled={false}
        />
      </AlertContext.Provider>,
    );

    const button = screen.getByRole("button", {
      name: "editor.visualExplain.saveRawPlan",
    });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockSave).toHaveBeenCalled();
    expect(mockWriteTextFile).toHaveBeenCalledWith("/path/to/file.json", rawContent);
    expect(showAlert).toHaveBeenCalledWith("editor.visualExplain.saveRawError", {
      kind: "error",
    });
    expect(console.error).toHaveBeenCalled();
  });
});
