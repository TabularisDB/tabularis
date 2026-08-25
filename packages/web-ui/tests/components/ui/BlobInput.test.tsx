import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlobInput } from "../../../src/components/ui/BlobInput";

const platform = {
  chooseBlob: vi.fn(),
  previewBlobReference: vi.fn(),
  fetchBlobReference: vi.fn(),
  fetchDatabaseBlob: vi.fn(),
  downloadFile: vi.fn(),
};

vi.mock("../../../src/hooks/usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => platform,
}));

describe("BlobInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.previewBlobReference.mockResolvedValue(null);
    platform.downloadFile.mockResolvedValue(true);
  });

  it("uploads through the semantic platform adapter", async () => {
    const onChange = vi.fn();
    platform.chooseBlob.mockResolvedValue(
      "BLOB_UPLOAD_REF:4:application/octet-stream:00000000-0000-4000-8000-000000000000",
    );
    render(<BlobInput value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        "BLOB_UPLOAD_REF:4:application/octet-stream:00000000-0000-4000-8000-000000000000",
      );
    });
  });

  it("downloads pending uploads without serializing their opaque token", async () => {
    const value =
      "BLOB_UPLOAD_REF:4:application/octet-stream:00000000-0000-4000-8000-000000000000";
    platform.fetchBlobReference.mockResolvedValue({
      contents: new Uint8Array([0, 1, 2, 3]),
      mimeType: "application/octet-stream",
    });
    render(<BlobInput value={value} onChange={vi.fn()} dataType="BLOB" />);

    fireEvent.click(screen.getByTitle("blobInput.download"));

    await waitFor(() => {
      expect(platform.fetchBlobReference).toHaveBeenCalledWith(value);
      expect(platform.downloadFile).toHaveBeenCalledWith({
        fileName: "download.bin",
        contents: new Uint8Array([0, 1, 2, 3]),
        filters: [{ name: "BLOB", extensions: ["bin"] }],
      });
    });
  });

  it("fetches truncated database blobs through tokenized platform downloads", async () => {
    const value = "BLOB:100:image/png:iVBORw==";
    platform.fetchDatabaseBlob.mockResolvedValue({
      contents: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
    });
    render(
      <BlobInput
        value={value}
        onChange={vi.fn()}
        dataType="BLOB"
        connectionId="connection-1"
        tableName="files"
        colName="payload"
        pkMap={{ id: 1 }}
      />,
    );

    fireEvent.click(screen.getByTitle("blobInput.download"));

    await waitFor(() => {
      expect(platform.fetchDatabaseBlob).toHaveBeenCalledWith({
        connectionId: "connection-1",
        table: "files",
        colName: "payload",
        pkMap: { id: 1 },
      });
    });
  });
});
