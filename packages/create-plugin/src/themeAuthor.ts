import { closeSync, constants, chmodSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseThemeDefinition, parseThemePackageManifest, THEME_INPUT_LIMITS } from "../../web-ui/src/utils/themePackageValidation";
import { isThemePackagePath, themePackageId } from "../../web-ui/src/utils/themePackageIdentity";
import { createThemeArchive } from "../../web-ui/src/utils/themeArchive";
import type { ThemePackageManifestV1 } from "../../web-ui/src/types/themePackage";
import licenses from "./theme-licenses.json";
import definitionSchema from "../../web-ui/src/schemas/theme-definition-v1.json";
import { themeValidationWorkflow } from "./themeCi";

function readBounded(root: string, relative: string, limit: number): string {
  if (!isThemePackagePath(relative)) throw new Error(`Invalid payload path: ${relative}`);
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error("Theme root must be a real directory");
  let path = root;
  for (const segment of relative.split("/")) { path = join(path, segment); if (lstatSync(path).isSymbolicLink()) throw new Error(`Symlink not allowed: ${relative}`); }
  if (!lstatSync(path).isFile()) throw new Error(`Expected regular file: ${relative}`);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = fstatSync(fd);
    if (!metadata.isFile() || metadata.size > limit) throw new Error(`File exceeds limit: ${relative}`);
    const bytes = Buffer.alloc(limit + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    if (length > limit) throw new Error(`File exceeds limit: ${relative}`);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
  } finally { closeSync(fd); }
}

export function validateThemeDirectory(root: string, tag?: string): { manifest: ThemePackageManifestV1; files: Map<string, string> } {
  const source = readBounded(root, ".tabularium", THEME_INPUT_LIMITS.manifestBytes);
  const manifest = parseThemePackageManifest(source);
  if (tag !== undefined && tag !== `v${manifest.version}`) throw new Error("Tag must exactly match v<manifest.version>");
  const files = new Map([[".tabularium", source]]);
  for (const variant of manifest.theme_variants) {
    const definition = readBounded(root, variant.file, THEME_INPUT_LIMITS.definitionBytes);
    parseThemeDefinition(definition); files.set(variant.file, definition);
  }
  for (const name of ["README.md", "LICENSE", "LICENSE.txt"]) if (existsSync(join(root, name))) files.set(name, readBounded(root, name, THEME_INPUT_LIMITS.definitionBytes));
  // The exact packager is also the aggregate-budget/portable-path validator.
  createThemeArchive(files);
  return { manifest, files };
}

export function themeReleaseWorkflow(): string {
  return `name: Release theme
on:
  push:
    tags: ['v*']
permissions:
  contents: read
concurrency:
  group: theme-release-\${{ github.ref }}
  cancel-in-progress: false
jobs:
  release:
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: '22'
      - name: Validate and package offline
        env:
          THEME_TAG: \${{ github.ref_name }}
        run: |
          node tools/theme.mjs validate . --tag "$THEME_TAG"
          node tools/theme.mjs package . --tag "$THEME_TAG" --output theme-universal.zip
      - name: Create a draft release for review
        env:
          GH_TOKEN: \${{ github.token }}
          GH_REPO: \${{ github.repository }}
          THEME_TAG: \${{ github.ref_name }}
        run: gh release create "$THEME_TAG" theme-universal.zip --verify-tag --draft --generate-notes
`;
}

export function scaffoldTheme(target: string, name: string, minimum: string, bundle: string): void {
  const manifest: ThemePackageManifestV1 = { $schema: "https://registry.tabularis.dev/manifest.schema.json?kind=theme", name, version: "1.0.0", kind: "theme", min_runtime_version: minimum, theme_schema_version: 1, theme_variants: [
    { id: "light", name: "Light", file: "themes/light.json" }, { id: "dark", name: "Dark", file: "themes/dark.json" },
  ] };
  parseThemePackageManifest(JSON.stringify(manifest));
  if (existsSync(target)) throw new Error("Scaffold destination already exists; choose a new directory");
  if (!lstatSync(bundle).isFile()) throw new Error("Build the bundled theme tool before scaffolding");
  mkdirSync(target);
  const put = (path: string, text: string, mode = 0o644) => { const destination = join(target, path); mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, text, { flag: "wx", mode }); };
  put(".tabularium", JSON.stringify(manifest, null, 2) + "\n");
  for (const mode of ["light", "dark"]) put(`themes/${mode}.json`, JSON.stringify({ $schema: definitionSchema.$id, schemaVersion: 1, mode, colors: { accent: { primary: mode === "light" ? "#315bce" : "#91b6ff" } } }, null, 2) + "\n");
  put("README.md", `# ${name}\n\nTwo declarative Tabularis variants. Edit themes/*.json, then run:\n\n\`\`\`sh\nnode tools/theme.mjs validate .\nnode tools/theme.mjs package . --output theme-universal.zip\n\`\`\`\n\nUse Settings → Appearance → Local package to preview/install the ZIP. Installation does not select a variant. No account or network is needed.\n\n## Before publishing\n\nAssign an appropriate license and retain upstream attribution. Importing does not grant redistribution rights. Replace LICENSE.txt. Take screenshots of both variants; host them in your repository and add HTTPS screenshots metadata to .tabularium (not executable/archive payload).\n\nFor editor completion, the manifest references Tabularium's public kind-scoped schema and theme definitions reference the canonical JSON Schema hosted on GitHub. The offline validator uses its bundled host contract, never an author-supplied URL. Branch pushes and pull requests validate and package in CI; tags create draft releases. If targeting another registry, update the manifest schema hint accordingly.\n\nSet min_runtime_version to the actual first supporting Tabularis release, not an older release with the same development version. No supporting release has been assigned by this scaffold. Match manifest version to the v-prefixed tag. Push a tag to create a draft GitHub release, review its universal ZIP, then publish the release and submit your repository through Tabularium. A GitHub release does not imply registry authorization, moderation approval, theme-kind enablement or successful ingestion.\n\nFull guide: https://github.com/TabularisDB/tabularis/blob/main/packages/create-plugin/THEMES.md\n`);
  put("LICENSE.txt", "UNLICENSED — choose a license and obtain redistribution rights before publishing.\n");
  put(".gitignore", "*.zip\nnode_modules/\n.DS_Store\n");
  put("package.json", JSON.stringify({ name, version: "1.0.0", private: true, scripts: { validate: "node tools/theme.mjs validate .", package: "node tools/theme.mjs package . --output theme-universal.zip" } }, null, 2) + "\n");
  put(".github/workflows/release.yml", themeReleaseWorkflow());
  put(".github/workflows/validate.yml", themeValidationWorkflow());
  put(".vscode/settings.json", JSON.stringify({ "files.associations": { ".tabularium": "json" } }, null, 2) + "\n");
  put("tools/THIRD-PARTY-LICENSES.txt", licenses.map((entry) => `${entry.package}@${entry.version}\n${entry.license}`).join("\n\n"));
  copyFileSync(bundle, join(target, "tools/theme.mjs"), constants.COPYFILE_EXCL);
  chmodSync(join(target, "tools/theme.mjs"), 0o755);
}

export function runThemeAuthor(argv: string[], bundle: string): string {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    dir: { type: "string" }, "min-runtime-version": { type: "string" }, output: { type: "string" }, tag: { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help || !positionals[0]) return "tabularis-theme scaffold <slug> --dir <new-directory> --min-runtime-version <version>\ntabularis-theme validate [directory] [--tag v1.0.0]\ntabularis-theme package [directory] --output <new-archive.zip> [--tag v1.0.0]";
  const [command, argument] = positionals;
  if (command === "scaffold") {
    if (!argument || !values["min-runtime-version"]) throw new Error("Scaffold needs a slug and explicit --min-runtime-version");
    const target = resolve(values.dir ?? argument); scaffoldTheme(target, argument, values["min-runtime-version"], bundle); return `Created ${target}`;
  }
  if (command !== "validate" && command !== "package") throw new Error("Unknown theme command");
  const root = resolve(argument ?? "."); const { manifest, files } = validateThemeDirectory(root, values.tag);
  if (command === "validate") return `Valid ${themePackageId(manifest)}@${manifest.version} (${manifest.theme_variants.length} variants)`;
  if (!values.output) throw new Error("Package requires --output (an existing file will not be overwritten)");
  const output = resolve(values.output); writeFileSync(output, createThemeArchive(files), { flag: "wx", mode: 0o644 }); return `Packaged ${output}`;
}
