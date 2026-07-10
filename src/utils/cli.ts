// Helpers for the terminal CLI install section in Settings.

/// Mirror of the Rust `CliInstallStatus` returned by `get_cli_install_status`
/// and `install_cli_shortcut`.
export interface CliInstallStatus {
  supported: boolean;
  installed: boolean;
  linkPath: string | null;
  inPath: boolean;
  /** True when the entry is a removable symlink (not a package-manager binary). */
  removable: boolean;
}

/** Directory containing the installed link, e.g. "/usr/local/bin/tabularis" → "/usr/local/bin". */
export function binDirFromLink(linkPath: string): string {
  const idx = linkPath.lastIndexOf("/");
  return idx > 0 ? linkPath.slice(0, idx) : linkPath;
}

/** Shell line the user can copy to make the install directory reachable. */
export function pathExportLine(dir: string): string {
  return `export PATH="${dir}:$PATH"`;
}

/**
 * Whether a failed install can be retried with `force`: the backend refuses
 * to overwrite a foreign `tabularis` entry unless forced.
 */
export function isForceableInstallError(message: string): boolean {
  return message.includes("already exists");
}
