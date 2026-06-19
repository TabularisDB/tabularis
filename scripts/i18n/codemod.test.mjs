import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transformSource, loadEn, loadHarmful } from "./codemod.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const norm = (s) => s.replace(/[ \t]+$/gm, "").replace(/\n+$/, "\n");

const input = readFileSync(join(__dirname, "fixtures/input.tsx"), "utf8");
const expected = readFileSync(join(__dirname, "fixtures/expected.tsx"), "utf8");

const { output, manifest, reviewNeeded } = transformSource(input, {
  en: loadEn(),
  harmful: loadHarmful(),
});

let ok = true;

if (norm(output) !== norm(expected)) {
  ok = false;
  console.error("--- output mismatch ---");
  const a = norm(output).split("\n");
  const b = norm(expected).split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.error(`L${i + 1}\n  got:      ${JSON.stringify(a[i])}\n  expected: ${JSON.stringify(b[i])}`);
    }
  }
}

if (reviewNeeded.length !== 1 || !reviewNeeded[0].includes("non-literal")) {
  ok = false;
  console.error("--- review-needed mismatch ---");
  console.error(reviewNeeded);
}

const expectKeys = new Set([
  "schema.close",
  "dataGrid.deleteRows_one",
  "dataGrid.deleteRows_other",
  "editor.notebook.cellResult_one",
  "editor.notebook.cellResult_other",
  "sidebar.deleteIndexConfirm",
  "generateSQL.tabDelete",
]);
const gotKeys = new Set(Object.values(manifest).flatMap((e) => e.originalKeys));
for (const k of expectKeys) {
  if (!gotKeys.has(k)) {
    ok = false;
    console.error(`--- manifest missing key: ${k} ---`);
  }
}

// Plural entries must carry the stem + en forms so the backfill can rebuild
// each target locale's own plural set.
const pluralEntry = Object.values(manifest).find((e) => e.kind === "plural");
if (!pluralEntry || pluralEntry.stem == null || pluralEntry.forms == null) {
  ok = false;
  console.error("--- plural manifest entry missing stem/forms ---", pluralEntry);
}
const harmfulEntry = Object.values(manifest).find((e) => e.kind === "harmful");
if (!harmfulEntry || harmfulEntry.context == null) {
  ok = false;
  console.error("--- harmful manifest entry missing context ---", harmfulEntry);
}

if (ok) {
  console.log("PASS");
  process.exit(0);
} else {
  console.error("FAIL");
  process.exit(1);
}
