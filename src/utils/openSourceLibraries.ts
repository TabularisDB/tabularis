export interface OpenSourceLibrary {
  name: string;
  version: string;
}

export interface OpenSourceLibrarySection {
  id:
    | "npm-runtime"
    | "npm-tooling"
    | "cargo-runtime"
    | "cargo-tooling";
  ecosystem: "npm" | "cargo";
  libraries: readonly OpenSourceLibrary[];
}

export const OPEN_SOURCE_LIBRARY_SECTIONS: readonly OpenSourceLibrarySection[] = [
  {
    id: "npm-runtime",
    ecosystem: "npm",
    libraries: [
      { name: "@monaco-editor/react", version: "^4.7.0" },
      { name: "@tailwindcss/postcss", version: "^4.2.2" },
      { name: "@tanstack/react-table", version: "^8.21.3" },
      { name: "@tanstack/react-virtual", version: "^3.13.23" },
      { name: "@tauri-apps/api", version: "^2.10.1" },
      { name: "@tauri-apps/plugin-clipboard-manager", version: "~2.3.2" },
      { name: "@tauri-apps/plugin-dialog", version: "^2.6.0" },
      { name: "@tauri-apps/plugin-fs", version: "^2.4.5" },
      { name: "@tauri-apps/plugin-opener", version: "^2.5.3" },
      { name: "@tauri-apps/plugin-updater", version: "~2.10.0" },
      { name: "@types/dagre", version: "^0.7.54" },
      { name: "@xyflow/react", version: "^12.10.2" },
      { name: "buffer", version: "^6.0.3" },
      { name: "clsx", version: "^2.1.1" },
      { name: "dagre", version: "^0.8.5" },
      { name: "dbgate-query-splitter", version: "^4.12.0" },
      { name: "i18next", version: "^25.10.10" },
      { name: "i18next-browser-languagedetector", version: "^8.2.1" },
      { name: "lucide-react", version: "^0.563.0" },
      { name: "monaco-editor", version: "^0.55.1" },
      { name: "process", version: "^0.11.10" },
      { name: "react", version: "^19.2.4" },
      { name: "react-dom", version: "^19.2.4" },
      { name: "react-i18next", version: "^16.6.6" },
      { name: "react-markdown", version: "^10.1.0" },
      { name: "react-router-dom", version: "^7.13.2" },
      { name: "recharts", version: "^3.8.1" },
      { name: "util", version: "^0.12.5" },
      { name: "wkx", version: "^0.5.0" },
    ],
  },
  {
    id: "npm-tooling",
    ecosystem: "npm",
    libraries: [
      { name: "@eslint/js", version: "^9.39.4" },
      { name: "@tauri-apps/cli", version: "^2.10.1" },
      { name: "@testing-library/dom", version: "^10.4.1" },
      { name: "@testing-library/jest-dom", version: "^6.9.1" },
      { name: "@testing-library/react", version: "^16.3.2" },
      { name: "@types/node", version: "^24.12.0" },
      { name: "@types/react", version: "^19.2.14" },
      { name: "@types/react-dom", version: "^19.2.3" },
      { name: "@vitejs/plugin-react", version: "^5.2.0" },
      { name: "@vitest/coverage-v8", version: "^4.1.2" },
      { name: "autoprefixer", version: "^10.4.27" },
      { name: "conventional-changelog", version: "^7.2.0" },
      { name: "conventional-changelog-angular", version: "^8.3.1" },
      { name: "eslint", version: "^9.39.4" },
      { name: "eslint-plugin-react-hooks", version: "^7.0.1" },
      { name: "eslint-plugin-react-refresh", version: "^0.4.26" },
      { name: "globals", version: "^16.5.0" },
      { name: "jsdom", version: "^28.1.0" },
      { name: "postcss", version: "^8.5.8" },
      { name: "tailwindcss", version: "^4.2.2" },
      { name: "typescript", version: "~5.9.3" },
      { name: "typescript-eslint", version: "^8.58.0" },
      { name: "vite", version: "^7.3.1" },
      { name: "vitest", version: "^4.1.2" },
    ],
  },
  {
    id: "cargo-runtime",
    ecosystem: "cargo",
    libraries: [
      { name: "async-trait", version: "0.1" },
      { name: "base64", version: "0.22.1" },
      { name: "chrono", version: "0.4.43" },
      { name: "clap", version: "4.5.56" },
      { name: "csv", version: "1.4.0" },
      { name: "deadpool-postgres", version: "0.14.1" },
      { name: "directories", version: "6.0.0" },
      { name: "futures", version: "0.3.31" },
      { name: "gtk", version: "0.18" },
      { name: "infer", version: "0.16" },
      { name: "keyring", version: "3.6.3" },
      { name: "log", version: "0.4" },
      { name: "native-tls", version: "0.2.13" },
      { name: "once_cell", version: "1.20" },
      { name: "openssl", version: "0.10" },
      { name: "postgres-native-tls", version: "0.5.1" },
      { name: "reqwest", version: "0.13.1" },
      { name: "russh", version: "0.43" },
      { name: "russh-keys", version: "0.43" },
      { name: "rust_decimal", version: "1.36" },
      { name: "serde", version: "1.0" },
      { name: "serde_json", version: "1.0" },
      { name: "serde_yaml", version: "0.9.34" },
      { name: "sqlx", version: "0.8.6" },
      { name: "sysinfo", version: "0.32" },
      { name: "tauri", version: "2.10.2" },
      { name: "tauri-plugin-clipboard-manager", version: "2" },
      { name: "tauri-plugin-dialog", version: "2.6.0" },
      { name: "tauri-plugin-fs", version: "2.4.5" },
      { name: "tauri-plugin-log", version: "2" },
      { name: "tauri-plugin-opener", version: "2" },
      { name: "tauri-plugin-updater", version: "2" },
      { name: "tokio", version: "1.49.0" },
      { name: "tokio-postgres", version: "0.7.13" },
      { name: "urlencoding", version: "2.1.3" },
      { name: "uuid", version: "1.20.0" },
      { name: "zip", version: "4.2.0" },
    ],
  },
  {
    id: "cargo-tooling",
    ecosystem: "cargo",
    libraries: [
      { name: "tauri-build", version: "2.5.3" },
      { name: "tempfile", version: "3.24.0" },
    ],
  },
];

export function getOpenSourceLibraryTotal(): number {
  return OPEN_SOURCE_LIBRARY_SECTIONS.reduce(
    (total, section) => total + section.libraries.length,
    0,
  );
}

export function getOpenSourceLibraryUrl(
  ecosystem: OpenSourceLibrarySection["ecosystem"],
  packageName: string,
): string {
  if (ecosystem === "npm") {
    return `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`;
  }

  return `https://crates.io/crates/${encodeURIComponent(packageName)}`;
}
