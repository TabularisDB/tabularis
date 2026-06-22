import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PO from "pofile";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OLD = join(ROOT, "src/i18n/locales");
const CAT = join(ROOT, "src/locales");
const LOCALES = ["it", "es", "zh", "fr", "de", "ja", "ru"];
const CONTEXT_DELIM = "\x04";

function flatten(obj, prefix = "", out = {}) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const nk = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, nk, out);
    else out[nk] = v;
  }
  return out;
}

const enJson = flatten(JSON.parse(readFileSync(join(OLD, "en.json"), "utf8")));
const oldLocale = Object.fromEntries(
  LOCALES.map((l) => [l, flatten(JSON.parse(readFileSync(join(OLD, `${l}.json`), "utf8")))]),
);
const manifest = JSON.parse(readFileSync(join(__dirname, "manifest.json"), "utf8"));

// SchemaModal was hand-converted in the Task-1 spike (not by the codemod), so its
// messages never reached the manifest. Bridge them here.
const SPIKE_EXTRAS = [
  { message: "Key", context: null, kind: "plain", stem: null, originalKeys: ["schema.colKey"] },
  { message: "NO", context: null, kind: "plain", stem: null, originalKeys: ["schema.no"] },
  { message: "Nullable", context: null, kind: "plain", stem: null, originalKeys: ["schema.colNullable"] },
  { message: "YES", context: null, kind: "plain", stem: null, originalKeys: ["schema.yes"] },
  { message: "Schema: {tableName}", context: null, kind: "interp", stem: null, originalKeys: ["schema.title"] },
];

// Skeleton: normalize placeholder NAMES (Lingui derives different names than i18next)
// and the plural/select count var, while PRESERVING all literal text incl. plural-form
// contents and `#`. Two messages join iff they are the same text up to placeholder names.
function skeleton(msg) {
  return msg
    .replace(/\{\s*[\w0-9]+\s*,\s*(plural|select|selectordinal)\s*,/g, "{\x01, $1,")
    .replace(/\{\s*[\w0-9]+\s*\}/g, "\x01");
}

// Build skeleton+context -> entry index; hard-fail on ambiguous collisions.
const index = new Map();
for (const entry of [...Object.values(manifest), ...SPIKE_EXTRAS]) {
  const k = skeleton(entry.message) + CONTEXT_DELIM + (entry.context || "");
  if (!index.has(k)) index.set(k, entry);
  else if (index.get(k).message !== entry.message) {
    // Same skeleton+context but different literal text: a real collision the join
    // cannot disambiguate. Surface it loudly rather than mistranslate.
    console.error(`COLLISION: ${JSON.stringify(index.get(k).message)} vs ${JSON.stringify(entry.message)}`);
  }
}

// Ordered placeholder tokens in a non-plural message ({name} or {0}).
const tokens = (s) => [...s.matchAll(/\{\s*([\w0-9]+)\s*\}/g)].map((m) => m[1]);
// Ordered i18next placeholder names ({{name}}).
const i18nTokens = (s) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);

// Map an i18next translation's {{name}} placeholders to the Lingui names used by the
// catalog msgid, by positional correspondence of the English source.
function buildNameMap(enMsgid, enKey) {
  const lui = tokens(enMsgid);
  const i18 = i18nTokens(enJson[enKey] ?? "");
  const map = {};
  const seen = [];
  for (const n of i18) if (!seen.includes(n)) seen.push(n);
  seen.forEach((name, i) => {
    if (i < lui.length) map[name] = lui[i];
  });
  return map;
}

function applyNameMap(text, map) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) =>
    map[name] !== undefined ? `{${map[name]}}` : `{${name}}`,
  );
}

// Parse a plural msgid: { countVar, formTokens: { cat: [tokens excluding count] } }.
function parsePlural(msgid) {
  const head = msgid.match(/^\{\s*([\w0-9]+)\s*,\s*plural\s*,/);
  const countVar = head[1];
  const body = msgid.slice(head[0].length, msgid.lastIndexOf("}"));
  const formTokens = {};
  const re = /(\w+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  let m;
  while ((m = re.exec(body))) formTokens[m[1]] = tokens(m[2]);
  return { countVar, formTokens };
}

// Resolve, for a locale, the first original key that actually has a translation.
function pickKey(keys, loc) {
  for (const k of keys) if (oldLocale[loc][k] != null && oldLocale[loc][k] !== "") return k;
  return null;
}

const I18N_PLURAL_CATS = ["zero", "one", "two", "few", "many", "other"];

function backfillLocale(loc) {
  return new Promise((resolve, reject) => {
    PO.load(join(CAT, `${loc}/messages.po`), (err, po) => {
      if (err) return reject(err);
      let filled = 0, empty = 0, unmatched = 0;
      const misses = [];
      for (const item of po.items) {
        if (!item.msgid) continue;
        const key = skeleton(item.msgid) + CONTEXT_DELIM + (item.msgctxt || "");
        const entry = index.get(key);
        if (!entry) {
          unmatched++;
          if (misses.length < 8) misses.push((item.msgctxt ? `[${item.msgctxt}] ` : "") + item.msgid.slice(0, 50));
          continue;
        }

        if (entry.kind === "plural" || /,\s*plural\s*,/.test(item.msgid)) {
          const { countVar, formTokens } = parsePlural(item.msgid);
          const stem = entry.stem;
          const parts = [];
          for (const cat of I18N_PLURAL_CATS) {
            const suffixKey = `${stem}_${cat}`;
            // every catalog plural carries a base i18next stem in some locales as _one/.._other
            const raw = oldLocale[loc][suffixKey];
            if (raw == null || raw === "") continue;
            // {{count}} -> #; other {{var}} -> the positional/named token the en form used.
            const formTok = formTokens[cat] ?? formTokens.other ?? [];
            let ti = 0;
            const text = raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => {
              if (name === "count") return "#";
              const tok = formTok[ti] ?? formTokens.other?.[ti] ?? name;
              ti++;
              return `{${tok}}`;
            });
            parts.push(`${cat} {${text}}`);
          }
          if (!parts.length) { empty++; continue; }
          item.msgstr = [`{${countVar}, plural, ${parts.join(" ")}}`];
          filled++;
          continue;
        }

        const ok = pickKey(entry.originalKeys, loc);
        if (!ok) { empty++; continue; }
        const translation = oldLocale[loc][ok];
        const map = buildNameMap(item.msgid, ok);
        item.msgstr = [applyNameMap(translation, map)];
        filled++;
      }
      writeFileSync(join(CAT, `${loc}/messages.po`), po.toString());
      resolve({ loc, filled, empty, unmatched, misses, total: po.items.length });
    });
  });
}

const results = [];
for (const loc of LOCALES) results.push(await backfillLocale(loc));
console.log("locale  filled  empty  unmatched  total");
for (const r of results) {
  console.log(`${r.loc.padEnd(6)}  ${String(r.filled).padStart(6)}  ${String(r.empty).padStart(5)}  ${String(r.unmatched).padStart(9)}  ${String(r.total).padStart(5)}`);
  if (r.unmatched) console.log(`   unmatched samples: ${r.misses.join(" | ")}`);
}
