import kleur from "kleur";

import type { MigrateResult } from "./migrate";

export function printCreated(slug: string, targetDir: string, withUi: boolean): void {
  console.log("");
  console.log(kleur.green("✓") + " " + kleur.bold(`Created ${slug}`) + kleur.dim(` at ${targetDir}`));
  console.log("");
  console.log(kleur.bold("Next steps:"));
  console.log("");
  console.log("  " + kleur.cyan(`cd ${slug}`));
  console.log("  " + kleur.cyan("just dev-install") + kleur.dim("     # build + copy into Tabularis plugins dir"));
  if (withUi) {
    console.log("  " + kleur.cyan("pnpm -C ui install && pnpm -C ui build") + kleur.dim("  # build the UI extension"));
  }
  console.log("");
  console.log(kleur.dim("Then open Tabularis and look for your driver in the connection picker."));
  console.log(kleur.dim("Full plugin guide: https://github.com/TabularisDB/tabularis/blob/main/plugins/PLUGIN_GUIDE.md"));
  console.log("");
}

export function printMigrated(targetDir: string, result: MigrateResult): void {
  console.log("");
  if (result.changed.length === 0) {
    console.log(kleur.yellow("•") + " " + (result.warnings[0] ?? "Nothing to migrate."));
    console.log("");
    return;
  }
  console.log(kleur.green("✓") + " " + kleur.bold("Migrated to .tabularium") + kleur.dim(` in ${targetDir}`));
  console.log("");
  for (const change of result.changed) {
    console.log("  " + kleur.dim("•") + " " + change);
  }
  if (result.warnings.length > 0) {
    console.log("");
    for (const warning of result.warnings) {
      console.log(kleur.yellow("  ! ") + warning);
    }
  }
  console.log("");
  if (result.ciRegenerated) {
    console.log(kleur.dim("Release workflow is registry-ready (publishes .tabularium as a standalone"));
    console.log(kleur.dim("asset). Commit the changes and republish."));
  } else {
    console.log(kleur.dim("Next: make your release workflow publish .tabularium as a standalone asset —"));
    console.log(kleur.dim("the registry resolves the manifest from release assets, not the bundle zips."));
    console.log(kleur.dim("Re-run with --ci to regenerate it from the template. Then commit and republish."));
  }
  console.log("");
}

export function printError(message: string): void {
  console.error(kleur.red("✗ ") + message);
}

export function printHelp(): void {
  console.log(`
${kleur.bold("@tabularis/create-plugin")} — scaffold a new Tabularis driver plugin

${kleur.bold("Usage:")}
  npm create @tabularis/plugin@latest [--] [options] <name>
  npx @tabularis/create-plugin [options] <name>
  npx @tabularis/create-plugin migrate [path]

${kleur.bold("Commands:")}
  <name>                 Scaffold a new plugin (default)
  migrate [path]         Convert an existing manifest.json plugin to .tabularium

${kleur.bold("Arguments:")}
  <name>                 Plugin name (slugified to lowercase with hyphens)
  [path]                 Plugin project to migrate (default: current directory)

${kleur.bold("Options:")}
  --db-type <kind>       network | file | folder | api   (default: network)
  --quote <char>         "  |  \`                         (default: ")
  --with-ui              Also scaffold a ui/ subworkspace using @tabularis/plugin-api
  --no-git               Skip \`git init\` on the new project
  --ci                   (migrate) Regenerate release.yml from the registry-ready template
  --dir <path>           Target directory               (default: ./<name>)
  -v, --version          Print version
  -h, --help             Print this help

${kleur.bold("Examples:")}
  npm create @tabularis/plugin@latest my-driver
  npm create @tabularis/plugin@latest sqlite-like -- --db-type=file
  npx @tabularis/create-plugin hackernews --db-type=api --with-ui
  npx @tabularis/create-plugin migrate ./my-driver
  npx @tabularis/create-plugin migrate ./my-driver --ci
`);
}
