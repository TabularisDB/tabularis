import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts", theme: "src/theme-cli.ts" },
  noExternal: ["ajv", "semver", "jsonc-parser"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  dts: false,
  sourcemap: false,
  clean: true,
  minify: false,
  splitting: false,
  shims: false,
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __themeCreateRequire } from 'node:module';\nconst require = __themeCreateRequire(import.meta.url);" },
});
