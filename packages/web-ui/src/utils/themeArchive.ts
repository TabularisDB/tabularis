import { parseThemeDefinition, parseThemePackageManifest, THEME_INPUT_LIMITS } from "./themePackageValidation";
import { isThemePackagePath } from "./themePackageIdentity";

/** Deterministic stored ZIP: UTF-8 names, fixed DOS epoch, regular 0644 files. */
export function createThemeArchive(files: ReadonlyMap<string, string>): Uint8Array {
  const manifest = parseThemePackageManifest(files.get(".tabularium") ?? "");
  const allowed = new Set([".tabularium", "README.md", "LICENSE", "LICENSE.txt", ...manifest.theme_variants.map((variant) => variant.file)]);
  for (const variant of manifest.theme_variants) parseThemeDefinition(files.get(variant.file) ?? "");
  if (files.size > THEME_INPUT_LIMITS.archiveEntries) throw new Error("Too many package files");
  const chunks: Uint8Array[] = []; const central: Uint8Array[] = [];
  const names = new Set<string>(); const encoder = new TextEncoder();
  let offset = 0; let centralSize = 0;
  for (const [name, content] of [...files.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!allowed.has(name) || !isThemePackagePath(name) || names.has(name.toLowerCase())) throw new Error(`Unsupported package path: ${name}`);
    names.add(name.toLowerCase());
    const filename = encoder.encode(name); const data = encoder.encode(content);
    if (data.length > (name === ".tabularium" ? THEME_INPUT_LIMITS.manifestBytes : THEME_INPUT_LIMITS.definitionBytes)) throw new Error(`Package file exceeds limit: ${name}`);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + filename.length); const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(12, 33, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, filename.length, true); local.set(filename, 30);
    const directory = new Uint8Array(46 + filename.length); const dv = new DataView(directory.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 0x0314, true); dv.setUint16(6, 20, true); dv.setUint16(8, 0x0800, true); dv.setUint16(14, 33, true);
    dv.setUint32(16, crc, true); dv.setUint32(20, data.length, true); dv.setUint32(24, data.length, true); dv.setUint16(28, filename.length, true);
    dv.setUint32(38, 0o100644 * 65536, true); dv.setUint32(42, offset, true); directory.set(filename, 46);
    chunks.push(local, data); central.push(directory); offset += local.length + data.length; centralSize += directory.length;
    if (offset + centralSize + 22 > THEME_INPUT_LIMITS.archiveBytes) throw new Error("Theme archive exceeds its byte limit");
  }
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.size, true); ev.setUint16(10, files.size, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + 22); let position = 0;
  for (const chunk of [...chunks, ...central, end]) { output.set(chunk, position); position += chunk.length; }
  return output;
}
