import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/react.ts", "src/flow.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: false,
  clean: true,
  minify: false,
  splitting: false,
  treeshake: true,
  target: "es2022",
  external: [
    "react",
    "react/jsx-runtime",
    "react-i18next",
    "@xyflow/react",
    "dagre",
    "clsx",
    "lucide-react",
  ],
});
