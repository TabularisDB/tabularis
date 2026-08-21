import fs from "node:fs";
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

const tauriBoundaryAllowlist = JSON.parse(
  fs.readFileSync(
    new URL("./scripts/web-ui-tauri-boundary-allowlist.json", import.meta.url),
    "utf8",
  ),
);
const tauriImportExceptions = [
  ...tauriBoundaryAllowlist.adapterFiles,
  ...Object.keys(tauriBoundaryAllowlist.legacyTauriImports),
];

export default defineConfig([
  globalIgnores(["dist", "tests", "coverage", "src-tauri/target/**"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tauri-apps/**"],
              message: "Use a frontend transport or platform adapter instead of importing Tauri directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: tauriImportExceptions,
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);
