import { parseArgs } from "node:util";
import { resolve } from "node:path";

import { migratePlugin } from "./migrate";
import { printCreated, printError, printHelp, printMigrated } from "./print";
import { scaffold } from "./scaffold";
import { titleCase, validateDbType, validateName, validateQuote } from "./validate";

const PACKAGE_VERSION = "0.1.0";
const PLUGIN_API_VERSION = "0.1.0";
const MIN_TABULARIS_VERSION = "0.9.20";

function main(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "db-type": { type: "string" },
        quote: { type: "string" },
        "with-ui": { type: "boolean", default: false },
        "no-git": { type: "boolean", default: false },
        ci: { type: "boolean", default: false },
        dir: { type: "string" },
        version: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    });
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    printHelp();
    return 1;
  }

  if (parsed.values.help) {
    printHelp();
    return 0;
  }
  if (parsed.values.version) {
    console.log(PACKAGE_VERSION);
    return 0;
  }

  if (parsed.positionals[0] === "migrate") {
    return runMigrate(parsed);
  }

  const rawName = parsed.positionals[0];
  if (!rawName) {
    printError("missing <name> argument");
    printHelp();
    return 1;
  }

  const nameCheck = validateName(rawName);
  if (!nameCheck.ok) {
    printError(`invalid name: ${nameCheck.reason}`);
    if (nameCheck.slug) {
      printError(`(slugified to "${nameCheck.slug}", which still failed)`);
    }
    return 1;
  }

  let dbType, quote;
  try {
    dbType = validateDbType(parsed.values["db-type"] as string | undefined);
    quote = validateQuote(parsed.values.quote as string | undefined);
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const slug = nameCheck.slug;
  const targetDir = resolve(
    (parsed.values.dir as string | undefined) ?? slug,
  );

  try {
    scaffold({
      slug,
      displayName: titleCase(slug),
      dbType,
      quote,
      withUi: Boolean(parsed.values["with-ui"]),
      targetDir,
      gitInit: !parsed.values["no-git"],
      pluginApiVersion: PLUGIN_API_VERSION,
      minTabularisVersion: MIN_TABULARIS_VERSION,
    });
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 1;
  }

  printCreated(slug, targetDir, Boolean(parsed.values["with-ui"]));
  return 0;
}

/**
 * `migrate [path]` — convert a legacy `manifest.json` plugin to a `.tabularium`
 * bundle in place. Operates on the given path, or `--dir`, or the cwd.
 */
function runMigrate(parsed: ReturnType<typeof parseArgs>): number {
  const target = resolve(
    parsed.positionals[1] ?? (parsed.values.dir as string | undefined) ?? process.cwd(),
  );
  try {
    const result = migratePlugin(target, { ci: Boolean(parsed.values.ci) });
    printMigrated(target, result);
    return 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const exitCode = main(process.argv.slice(2));
if (exitCode !== 0) process.exit(exitCode);
