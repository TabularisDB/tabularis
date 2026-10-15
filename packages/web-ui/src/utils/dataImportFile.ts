import type { ChosenInputFile, PlatformCapabilities } from '../platform/capabilities';

export const DATA_IMPORT_FILE_LIMIT = 20 * 1024 * 1024;
export const DATA_IMPORT_EXTENSIONS = ['csv', 'tsv', 'json', 'md'];

export class DataImportFileError extends Error {
  readonly code: 'tooLarge' | 'unsupported' | 'notFile';

  constructor(code: DataImportFileError['code']) {
    super(code);
    this.code = code;
  }
}

/** Read supported text through the active platform's opaque file reference. */
export async function readDataImportFile(
  file: ChosenInputFile,
  platform: Pick<PlatformCapabilities, 'readInputFile'>,
): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !DATA_IMPORT_EXTENSIONS.includes(extension)) {
    throw new DataImportFileError('unsupported');
  }
  const bytes = await platform.readInputFile(file.reference);
  if (bytes.byteLength > DATA_IMPORT_FILE_LIMIT) {
    throw new DataImportFileError('tooLarge');
  }
  return new TextDecoder().decode(bytes);
}
