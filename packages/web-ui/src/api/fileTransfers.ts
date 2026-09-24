export interface FileTransferMetadata {
  readonly token: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly expiresAt: string;
}

export interface FileUploadRequest {
  readonly contents: Blob;
  readonly fileName: string;
  /**
   * Binds the opaque token to the application workflow that may consume it.
   */
  readonly purpose: string;
}
