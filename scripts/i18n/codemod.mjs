import { readFileSync, writeFileSync, globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Project, SyntaxKind } from "ts-morph";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

export function loadEn() {
  const en = JSON.parse(
    readFileSync(join(__dirname, "../../src/i18n/locales/en.json"), "utf8"),
  );
  return flatten(en);
}

export function loadHarmful() {
  return JSON.parse(readFileSync(join(__dirname, "harmful-groups.json"), "utf8"));
}

// Convert i18next interpolation ({{var}}) to Lingui ICU ({var}).
// In a plural context, {{count}} becomes the literal `#`.
function toIcu(text, { pluralCount = false } = {}) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => {
    if (pluralCount && name === "count") return "#";
    return `{${name}}`;
  });
}

function interpolationVars(text) {
  const vars = [];
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  let m;
  while ((m = re.exec(text))) vars.push(m[1]);
  return vars;
}

function hasInterpolation(text) {
  return /\{\{\s*\w+\s*\}\}/.test(text);
}

// A double-quoted JSON-style string literal for use inside t({ message: ... }).
function jsonString(text) {
  return JSON.stringify(text);
}

// Build a tagged-template body from i18next text, turning {{var}} into ${var}.
// Returns null if the text cannot be safely embedded in a template literal.
function toTemplate(text) {
  if (text.includes("`")) return null;
  // Escape backslashes first, then any literal ${ that is NOT one of our placeholders.
  // We rebuild by tokenizing on {{var}}.
  const parts = text.split(/(\{\{\s*\w+\s*\}\})/);
  let out = "";
  for (const part of parts) {
    const m = part.match(/^\{\{\s*(\w+)\s*\}\}$/);
    if (m) {
      out += "${" + m[1] + "}";
      continue;
    }
    // Literal segment: escape backslashes and stray ${ sequences.
    if (part.includes("${")) return null;
    out += part.replace(/\\/g, "\\\\");
  }
  return out;
}

function getOptionsObject(callExpr) {
  const args = callExpr.getArguments();
  if (args.length < 2) return null;
  const arg = args[1];
  if (arg.getKind() !== SyntaxKind.ObjectLiteralExpression) return null;
  return arg;
}

function getProperty(objLiteral, name) {
  const prop = objLiteral.getProperty(name);
  if (!prop) return null;
  if (prop.getKind() === SyntaxKind.PropertyAssignment) {
    return prop.getInitializer().getText();
  }
  if (prop.getKind() === SyntaxKind.ShorthandPropertyAssignment) {
    return name;
  }
  return null;
}

export function transformSource(code, opts) {
  const { en, harmful } = opts;
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("input.tsx", code, { overwrite: true });

  const manifest = {};
  const reviewNeeded = [];
  let needPluralImport = false;
  let usedT = false;

  // Manifest entries are keyed by the Lingui message identity (msgid, plus the
  // gettext context delimiter when present) and carry everything the Task-4
  // backfill needs to rebuild each target locale: `kind`, `context`, the source
  // `message`, the plural `stem` (i18next base key, so the backfill can gather
  // the target locale's own _one/_few/_many/_other forms), the en `forms`, and
  // every original i18next key that collapsed into this message.
  const record = ({ message, context = null, key, kind, stem = null, forms = null }) => {
    const mkey = context ? message + CONTEXT_DELIM + context : message;
    if (!manifest[mkey]) {
      manifest[mkey] = { kind, context, message, stem, forms, originalKeys: [] };
    }
    if (!manifest[mkey].originalKeys.includes(key)) {
      manifest[mkey].originalKeys.push(key);
    }
  };

  const note = (node, reason) => {
    const { line } = sf.getLineAndColumnAtPos(node.getStart());
    reviewNeeded.push(`input.tsx:${line}  ${reason}  ${node.getText().slice(0, 80)}`);
  };

  const calls = sf
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((c) => {
      const expr = c.getExpression();
      return expr.getKind() === SyntaxKind.Identifier && expr.getText() === "t";
    });

  for (const call of calls) {
    const args = call.getArguments();
    if (args.length === 0) continue;
    const first = args[0];

    if (first.getKind() !== SyntaxKind.StringLiteral) {
      note(call, "non-literal t() key");
      usedT = true;
      continue;
    }

    const key = first.getLiteralValue();
    const opts = getOptionsObject(call);

    const oneKey = `${key}_one`;
    const otherKey = `${key}_other`;
    const isPluralKey = en[oneKey] !== undefined && en[otherKey] !== undefined;
    const hasCount = opts && opts.getProperty("count") !== undefined;

    // key not in en (and not a plural base) -> review.
    if (en[key] === undefined && !isPluralKey) {
      note(call, "key not in en");
      usedT = true;
      continue;
    }

    if (isPluralKey && hasCount) {
      const countExpr = getProperty(opts, "count");
      const oneIcu = toIcu(en[oneKey], { pluralCount: true });
      const otherIcu = toIcu(en[otherKey], { pluralCount: true });
      call.replaceWithText(
        `plural(${countExpr}, { one: ${jsonString(oneIcu)}, other: ${jsonString(otherIcu)} })`,
      );
      // Lingui extracts the macro to a single ICU msgid; the exact string is the
      // join key into the extracted catalog. The backfill verifies every catalog
      // entry resolves, so any serialization drift surfaces loudly there.
      const pluralMessage = `{count, plural, one {${oneIcu}} other {${otherIcu}}}`;
      const forms = { one: oneIcu, other: otherIcu };
      record({ message: pluralMessage, kind: "plural", stem: key, forms, key: oneKey });
      record({ message: pluralMessage, kind: "plural", stem: key, forms, key: otherKey });
      needPluralImport = true;
      continue;
    }

    const text = en[key];

    if (harmful[key]) {
      const message = hasInterpolation(text) ? toIcu(text) : text;
      call.replaceWithText(
        `t({ message: ${jsonString(message)}, context: ${jsonString(harmful[key])} })`,
      );
      record({ message, context: harmful[key], kind: "harmful", key });
      usedT = true;
      continue;
    }

    if (hasInterpolation(text)) {
      const tpl = toTemplate(text);
      if (tpl === null) {
        note(call, "unsafe template interpolation");
        usedT = true;
        continue;
      }
      // The named values must be reachable as identifiers in scope; the options
      // object passes them, but the macro reads the in-scope variable directly.
      call.replaceWithText("t`" + tpl + "`");
      record({ message: toIcu(text), kind: "interp", key });
      usedT = true;
      continue;
    }

    // Plain string.
    const tpl = toTemplate(text);
    if (tpl === null) {
      note(call, "unsafe template literal");
      usedT = true;
      continue;
    }
    call.replaceWithText("t`" + tpl + "`");
    record({ message: text, kind: "plain", key });
    usedT = true;
  }

  // Rewrite hook + import only when the useTranslation import is present.
  const i18nImport = sf.getImportDeclaration(
    (d) => d.getModuleSpecifierValue() === "react-i18next",
  );
  if (i18nImport) {
    const named = i18nImport.getNamedImports().map((n) => n.getName());
    if (named.includes("useTranslation")) {
      if (named.length === 1) {
        i18nImport.setModuleSpecifier("@lingui/react/macro");
        i18nImport.getNamedImports()[0].setName("useLingui");
      } else {
        i18nImport.removeNamedImport(
          i18nImport.getNamedImports().find((n) => n.getName() === "useTranslation"),
        );
        sf.addImportDeclaration({
          moduleSpecifier: "@lingui/react/macro",
          namedImports: ["useLingui"],
        });
      }
      // const { t } = useTranslation(); -> useLingui()
      for (const callExpr of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const e = callExpr.getExpression();
        if (e.getKind() === SyntaxKind.Identifier && e.getText() === "useTranslation") {
          callExpr.replaceWithText("useLingui()");
        }
      }
    }
  }

  if (needPluralImport) {
    const macroImport = sf.getImportDeclaration(
      (d) => d.getModuleSpecifierValue() === "@lingui/core/macro",
    );
    if (macroImport) {
      if (!macroImport.getNamedImports().some((n) => n.getName() === "plural")) {
        macroImport.addNamedImport("plural");
      }
    } else {
      sf.insertImportDeclaration(0, {
        moduleSpecifier: "@lingui/core/macro",
        namedImports: ["plural"],
      });
    }
  }

  void usedT;
  return { output: sf.getFullText(), manifest, reviewNeeded };
}

function cli() {
  const patterns = process.argv.slice(2);
  if (patterns.length === 0) {
    console.error("usage: node codemod.mjs <glob...>");
    process.exit(1);
  }
  const en = loadEn();
  const harmful = loadHarmful();
  const files = [...new Set(patterns.flatMap((p) => globSync(p)))];

  const manifest = {};
  const reviewNeeded = [];
  for (const file of files) {
    const code = readFileSync(file, "utf8");
    const res = transformSource(code, { en, harmful });
    writeFileSync(file, res.output);
    for (const [mkey, entry] of Object.entries(res.manifest)) {
      if (!manifest[mkey]) {
        manifest[mkey] = { ...entry, originalKeys: [...entry.originalKeys] };
        continue;
      }
      for (const k of entry.originalKeys) {
        if (!manifest[mkey].originalKeys.includes(k)) manifest[mkey].originalKeys.push(k);
      }
    }
    for (const r of res.reviewNeeded) {
      reviewNeeded.push(r.replace(/^input\.tsx/, file));
    }
  }

  writeFileSync(
    join(__dirname, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  writeFileSync(
    join(__dirname, "review-needed.txt"),
    reviewNeeded.join("\n") + (reviewNeeded.length ? "\n" : ""),
  );
  console.log(
    `transformed ${files.length} files; ${Object.keys(manifest).length} messages; ${reviewNeeded.length} review sites`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cli();
}
