import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { open } from '@tauri-apps/plugin-dialog';
import { stat, readTextFile } from '@tauri-apps/plugin-fs';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { act } from '@testing-library/react';
import { DATA_IMPORT_FILE_LIMIT } from '../../../src/utils/dataImportFile';
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

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn(), readTextFile: vi.fn() }));

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
    vi.mocked(open).mockReset().mockResolvedValue('/tmp/items.csv');
    vi.mocked(stat).mockReset().mockResolvedValue({ size: 40, isFile: true } as Awaited<ReturnType<typeof stat>>);
    vi.mocked(readTextFile).mockReset().mockResolvedValue('sku,name\nKB-202,File Keyboard');
    vi.mocked(readText).mockReset().mockResolvedValue('sku\tname\nKB-101\tMechanical Keyboard');
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
  it.each([
    ['csv', 'sku,name\nKB-202,File Keyboard'],
    ['tsv', 'sku\tname\nKB-202\tFile Keyboard'],
    ['json', '[{"sku":"KB-202","name":"File Keyboard"}]'],
    ['md', '| sku | name |\n| --- | --- |\n| KB-202 | File Keyboard |'],
  ])('imports a %s file through the existing schema and row pipeline', async (extension, text) => {
    vi.mocked(open).mockResolvedValue(`/tmp/items.${extension}`);
    vi.mocked(readTextFile).mockResolvedValue(text);
    renderModal('sales');
    await screen.findByPlaceholderText('clipboardImport.tableNamePlaceholder');
    fireEvent.click(screen.getByRole('button', { name: 'clipboardImport.fileSource' }));
    await screen.findByText(`items.${extension}`);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, directory: false }));
    fireEvent.change(screen.getByPlaceholderText('clipboardImport.tableNamePlaceholder'), {target:{value:'imported_items'}});
    fireEvent.click(screen.getByRole('button', {name:'clipboardImport.import'}));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('execute_clipboard_import', {
      req: expect.objectContaining({ schema:'sales', table_name:'imported_items', rows:[['KB-202','File Keyboard']], create_table:true }),
    }));
  });

  it('keeps a quoted multiline CSV cell through import execution', async () => {
    vi.mocked(readTextFile).mockResolvedValue('id,note\n1,"first\nsecond"');
    renderModal();
    await screen.findByPlaceholderText('clipboardImport.tableNamePlaceholder');
    fireEvent.click(screen.getByRole('button', {name:'clipboardImport.fileSource'}));
    await screen.findByText('items.csv');
    fireEvent.change(screen.getByPlaceholderText('clipboardImport.tableNamePlaceholder'), {target:{value:'notes'}});
    fireEvent.click(screen.getByRole('button', {name:'clipboardImport.import'}));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('execute_clipboard_import', {
      req: expect.objectContaining({rows:[['1','first\nsecond']]}),
    }));
  });

  it('preserves the clipboard preview if the file picker is cancelled', async () => {
    vi.mocked(open).mockResolvedValue(null);
    renderModal();
    await screen.findAllByText('Mechanical Keyboard');
    fireEvent.click(screen.getByRole('button', {name:'clipboardImport.fileSource'}));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getAllByText('Mechanical Keyboard').length).toBeGreaterThan(0);
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it('rejects large files before reading and retains the prior preview', async () => {
    vi.mocked(stat).mockResolvedValue({size:DATA_IMPORT_FILE_LIMIT+1,isFile:true} as Awaited<ReturnType<typeof stat>>);
    renderModal();
    await screen.findAllByText('Mechanical Keyboard');
    fireEvent.click(screen.getByRole('button', {name:'clipboardImport.fileSource'}));
    await screen.findByText('clipboardImport.fileTooLarge');
    expect(readTextFile).not.toHaveBeenCalled();
    expect(screen.getAllByText('Mechanical Keyboard').length).toBeGreaterThan(0);
    expect(invokeMock).not.toHaveBeenCalledWith('execute_clipboard_import', expect.anything());
  });

  it('reports file read errors inline', async () => {
    vi.mocked(readTextFile).mockRejectedValue(new Error('Permission denied'));
    renderModal();
    await screen.findAllByText('Mechanical Keyboard');
    fireEvent.click(screen.getByRole('button', {name:'clipboardImport.fileSource'}));
    await screen.findByText('clipboardImport.fileReadError: Permission denied');
  });

  it('discards an older file read after the clipboard is selected', async () => {
    let finish!: (text:string) => void;
    vi.mocked(readTextFile).mockReturnValue(new Promise(resolve => {finish=resolve;}));
    renderModal();
    await screen.findAllByText('Mechanical Keyboard');
    fireEvent.click(screen.getByRole('button', {name:'clipboardImport.fileSource'}));
    await waitFor(() => expect(readTextFile).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', {name:'clipboardImport.clipboardSource'}));
    await screen.findAllByText('Mechanical Keyboard');
    await act(async () => {finish('sku,name\nKB-202,Stale File');});
    expect(screen.queryByText('Stale File')).not.toBeInTheDocument();
    expect(screen.queryByText('items.csv')).not.toBeInTheDocument();
  });

  it('discards pending file reads across close and reopen', async () => {
    let finish!: (text:string) => void;
    vi.mocked(readTextFile).mockReturnValue(new Promise(resolve => {finish=resolve;}));
    const props={onClose:vi.fn(),onSuccess:vi.fn()};
    const view=render(<ClipboardImportModal isOpen {...props}/>);
    await screen.findAllByText('Mechanical Keyboard');
    fireEvent.click(screen.getByRole('button', {name:'clipboardImport.fileSource'}));
    await waitFor(() => expect(readTextFile).toHaveBeenCalled());
    view.rerender(<ClipboardImportModal isOpen={false} {...props}/>);
    view.rerender(<ClipboardImportModal isOpen {...props}/>);
    await screen.findAllByText('Mechanical Keyboard');
    await act(async () => {finish('sku,name\nKB-202,Stale File');});
    expect(screen.queryByText('Stale File')).not.toBeInTheDocument();
  });

});
