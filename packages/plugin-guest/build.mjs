import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromRoot = createRequire(path.join(root, "package.json"));
let esbuild;
try {
  esbuild = requireFromRoot("esbuild");
} catch {
  // pnpm may have esbuild available through Vite without a root-level link.
  const requireFromVite = createRequire(requireFromRoot.resolve("vite"));
  esbuild = requireFromVite("esbuild");
}
const output = path.join(root, "src-tauri/resources/guest/runtime.js");
mkdirSync(path.dirname(output), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "packages/plugin-guest/src/runtime.ts")],
  outfile: output,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});
