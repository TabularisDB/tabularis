import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import { readFileSync } from "node:fs";

// Compiled catalog is keyed by the runtime id Lingui uses.
const compiled = readFileSync("src/locales/en/messages.ts", "utf8");
// Pick a known message and confirm generateMessageId reproduces its key.
const id = generateMessageId("Close");
// The catalog is embedded as a JSON.parse() string, so keys appear as \"id\" (escaped).
// Check both plain and JSON-escaped forms.
const found = compiled.includes(JSON.stringify(id)) || compiled.includes(`\\"${id}\\"`);
if (!found) {
  console.error(`FAIL: generateMessageId("Close")=${id} not found in compiled catalog`);
  process.exit(1);
}
console.log(`OK: runtime id for "Close" = ${id} (bridge usable for OTA)`);
