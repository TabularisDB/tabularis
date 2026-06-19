import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = join(__dirname, "../../src/i18n/locales");
const outFile = join(__dirname, "harmful-groups.json");

function flatten(obj, prefix = "", out = {}) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const nk = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, nk, out);
    else out[nk] = v;
  }
  return out;
}

function loadLocales() {
  const locales = {};
  for (const file of readdirSync(localesDir)) {
    if (!file.endsWith(".json")) continue;
    const code = file.replace(/\.json$/, "");
    locales[code] = flatten(JSON.parse(readFileSync(join(localesDir, file), "utf8")));
  }
  return locales;
}

function main() {
  const locales = loadLocales();
  const en = locales.en;
  const nonEn = Object.keys(locales).filter((c) => c !== "en");

  // Group keys by their en value.
  const byValue = new Map();
  for (const [key, value] of Object.entries(en)) {
    if (typeof value !== "string") continue;
    if (!byValue.has(value)) byValue.set(value, []);
    byValue.get(value).push(key);
  }

  const harmful = {};
  for (const [, keys] of byValue) {
    if (keys.length < 2) continue;
    // A group is harmful if any non-en locale has >1 distinct translation across these keys.
    let divergent = false;
    for (const locale of nonEn) {
      const seen = new Set();
      for (const key of keys) {
        const t = locales[locale][key];
        if (typeof t === "string") seen.add(t);
      }
      if (seen.size > 1) {
        divergent = true;
        break;
      }
    }
    if (!divergent) continue;
    for (const key of keys) {
      harmful[key] = key.split(".")[0];
    }
  }

  writeFileSync(outFile, JSON.stringify(harmful, null, 2) + "\n");
  console.log(`harmful keys: ${Object.keys(harmful).length}`);
  console.log(`harmful groups: ${new Set(Object.values(harmful)).size} namespaces touched`);
}

main();
