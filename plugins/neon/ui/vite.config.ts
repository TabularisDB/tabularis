import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    lib: { entry: "src/index.tsx", name: "__tabularis_plugin__", formats: ["iife"], fileName: () => "index.js" },
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "@tabularis/plugin-api"],
      output: { globals: { react: "React", "react/jsx-runtime": "ReactJSXRuntime", "@tabularis/plugin-api": "__TABULARIS_API__" } },
    },
  },
});
