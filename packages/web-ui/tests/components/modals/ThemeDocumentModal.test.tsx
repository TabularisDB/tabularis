import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeDocumentModal } from "../../../src/components/modals/ThemeDocumentModal";
import { builtinCatalog, resolveCatalogEntry } from "../../../src/utils/themeCatalog";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), previewTheme: vi.fn(), cancelPreview: vi.fn(), importTheme: vi.fn(), setTheme: vi.fn(), updatePersonalSource: vi.fn(), updateCustomTheme: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../../src/components/ui/ThemeSqlSample", () => ({ ThemeSqlSample: () => <div>SQL sample</div> }));
vi.mock("../../../src/hooks/useTheme", () => ({ useTheme: () => mocks }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockImplementation(async (_command, args) => ({ id: "theme:preview-document", name: args.name, source: args.source, revision: "preview", origin: { kind: "personal" }, readOnly: false, available: true, mode: "dark", format: "v1" }));
  mocks.importTheme.mockResolvedValue({ id: "custom-native-id" }); mocks.setTheme.mockResolvedValue(undefined);
});

function source(value: string) { fireEvent.change(screen.getByLabelText("themePackages.source"), { target: { value } }); }

describe("ThemeDocumentModal", () => {
  it("previews and edits independent editor data using the captured revision", async () => {
    const editor = { base: "vs-dark" as const, inherit: true, colors: {}, rules: [{ token: "string.sql", foreground: "ff0000" }] };
    const original = resolveCatalogEntry({ ...builtinCatalog().themes[0].entry, id: "custom-snapshot", name: "My copy", revision: "captured", origin: { kind: "personal" }, readOnly: false, editor });
    const edited = { ...editor, rules: [{ token: "string.sql", foreground: "0000ff" }] };
    mocks.invoke.mockResolvedValueOnce({ ...original.entry, id: "theme:preview-document", editor: edited });
    mocks.updatePersonalSource.mockResolvedValueOnce(original.resolved.theme);
    render(<ThemeDocumentModal isOpen onClose={vi.fn()} kind="edit" original={original} />);
    fireEvent.change(screen.getByLabelText("themePackages.snapshotEditor"), { target: { value: JSON.stringify(edited) } });
    fireEvent.click(screen.getByRole("button", { name: "themePackages.preview" })); await screen.findByText("themePackages.previewReady");
    expect(mocks.invoke).toHaveBeenCalledWith("preview_theme_document", { name: "My copy", source: JSON.stringify({ themeSnapshotVersion: 1, source: original.entry.source, editor: edited }) });
    expect(mocks.previewTheme).toHaveBeenCalledWith(expect.objectContaining({ source: original.entry.source, editor: edited }));
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(mocks.updatePersonalSource).toHaveBeenCalledWith("custom-snapshot", "My copy", original.entry.source, "captured", edited));
    expect(mocks.updateCustomTheme).not.toHaveBeenCalled();
  });

  it("retains the standalone snapshot container through preview and confirmation", async () => {
    const document = JSON.stringify({ themeSnapshotVersion: 1, source: "native-validated legacy source", editor: { base: "vs-dark", inherit: true } });
    mocks.invoke.mockResolvedValueOnce({ id: "theme:preview-document", name: "Snapshot", source: "native-validated legacy source", editor: { base: "vs-dark", inherit: true }, format: "legacy" });
    render(<ThemeDocumentModal isOpen onClose={vi.fn()} kind="tabularis" />);
    source(document);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.preview" })); await screen.findByText("themePackages.previewReady");
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(mocks.importTheme).toHaveBeenCalledWith(document, "themePackages.importedTheme"));
  });

  it("requires native preview before import and cancellation writes nothing", async () => {
    const close = vi.fn(); const view = render(<ThemeDocumentModal isOpen onClose={close} kind="tabularis" />);
    source('{"schemaVersion":1,"mode":"dark"}');
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "themePackages.preview" }));
    await screen.findByText("themePackages.previewReady");
    expect(mocks.invoke).toHaveBeenCalledWith("preview_theme_document", expect.objectContaining({ name: "themePackages.importedTheme" }));
    expect(mocks.previewTheme).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    view.unmount();
    expect(close).toHaveBeenCalledOnce(); expect(mocks.cancelPreview).toHaveBeenCalled();
    expect(mocks.importTheme).not.toHaveBeenCalled(); expect(mocks.setTheme).not.toHaveBeenCalled();
  });
  it("discloses conversion losses and requires acknowledgement before saving", async () => {
    render(<ThemeDocumentModal isOpen onClose={vi.fn()} kind="vscode" />);
    source('{"type":"dark","colors":{"editor.background":"#123456","unknown.color":"#fff"}}');
    fireEvent.click(screen.getByRole("button", { name: "themePackages.preview" }));
    await screen.findByText(/themePackages.diagnostics.unsupportedColor/);
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("themePackages.acknowledge"));
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(mocks.importTheme).toHaveBeenCalledOnce());
    expect(mocks.setTheme).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.importTheme.mock.calls[0][0])).toMatchObject({ schemaVersion: 1, mode: "dark" });
  });
  it("requires an explicit mode for ambiguous input and invalidates stale previews after edits", async () => {
    render(<ThemeDocumentModal isOpen onClose={vi.fn()} kind="vscode" />);
    source('{"type":"hcLight","colors":{"editor.background":"#ffffff"}}');
    fireEvent.click(screen.getByRole("button", { name: "themePackages.preview" }));
    await screen.findByText("themePackages.importErrors.modeRequired"); expect(mocks.invoke).not.toHaveBeenCalled();
    const mode = screen.getByLabelText("themePackages.mode");
    expect(mode.tagName).toBe("BUTTON");
    fireEvent.click(mode);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.modes.light", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "themePackages.preview" }));
    await screen.findByText("themePackages.previewReady");
    source('{"type":"light","colors":{"editor.background":"#eeeeee"}}');
    expect(screen.queryByText("themePackages.previewReady")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
  });
  it("restores automatic mode through the shared picker and invalidates a prepared preview", async () => {
    render(<ThemeDocumentModal isOpen onClose={vi.fn()} kind="vscode" />);
    source('{"type":"dark","colors":{"editor.background":"#123456"}}');
    const picker = screen.getByLabelText("themePackages.mode");
    expect(picker).toHaveTextContent("themePackages.detectMode");
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.modes.light", exact: true }));
    expect(picker).toHaveTextContent("themePackages.modes.light");
    fireEvent.click(screen.getByRole("button", { name: "themePackages.preview" }));
    await screen.findByText("themePackages.previewReady");
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("button", { name: "themePackages.detectMode", exact: true }));
    expect(picker).toHaveTextContent("themePackages.detectMode");
    expect(screen.queryByText("themePackages.previewReady")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "themePackages.preview" }));
    await screen.findByText("themePackages.previewReady");
    expect(JSON.parse(mocks.invoke.mock.lastCall?.[1].source).mode).toBe("dark");
  });

  it("does not repeat a committed import when applying its selection fails", async () => {
    mocks.setTheme.mockRejectedValueOnce(new Error("save_config failed"));
    render(<ThemeDocumentModal isOpen onClose={vi.fn()} kind="tabularis" />);
    source('{"schemaVersion":1,"mode":"dark"}');
    fireEvent.click(screen.getByRole("button", { name: "themePackages.preview" })); await screen.findByText("themePackages.previewReady");
    fireEvent.click(screen.getByLabelText("themePackages.applyAfterSave"));
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await screen.findByText(/themePackages.savedNotApplied/);
    expect(mocks.importTheme).toHaveBeenCalledOnce(); expect(mocks.setTheme).toHaveBeenCalledWith("custom-native-id");
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
  });
  it("contains keyboard focus, handles Escape and restores the invoking control", () => {
    const button = document.createElement("button"); document.body.append(button); button.focus();
    const close = vi.fn(); const view = render(<ThemeDocumentModal isOpen onClose={close} kind="tabularis" />);
    expect(screen.getByLabelText("themePackages.name")).toHaveFocus();
    expect(screen.getByRole("button", { name: "common.save" }).closest(".overflow-y-auto")).toBeNull();
    expect(screen.getByRole("button", { name: "themePackages.preview" }).closest(".overflow-y-auto")).toBeNull();
    screen.getByRole("dialog").focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "common.cancel" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
    view.unmount(); expect(button).toHaveFocus(); button.remove();
  });
});
