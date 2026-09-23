import { fileURLToPath } from "node:url";
import { runThemeAuthor } from "./themeAuthor";

try { console.log(runThemeAuthor(process.argv.slice(2), fileURLToPath(import.meta.url))); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
