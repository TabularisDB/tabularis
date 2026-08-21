#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND_ROOT = "packages/web-ui/src";
const ALLOWLIST_PATH = "scripts/web-ui-tauri-boundary-allowlist.json";

function scriptKind(filePath) {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function addCount(counts, file) {
  counts.set(file, (counts.get(file) ?? 0) + 1);
}

function usageEntries(counts) {
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, count]) => ({ file, count }));
}

export function collectBoundaryUsage(files) {
  const tauriImports = new Map();
  const directInvokes = new Map();

  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const sourceFile = ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(file.path),
    );
    const namedInvokes = new Set();
    const coreNamespaces = new Set();

    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }

      const moduleName = statement.moduleSpecifier.text;
      if (!moduleName.startsWith("@tauri-apps/")) continue;
      addCount(tauriImports, file.path);

      if (moduleName !== "@tauri-apps/api/core" || !statement.importClause) {
        continue;
      }
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === "invoke") {
            namedInvokes.add(element.name.text);
          }
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        coreNamespaces.add(bindings.name.text);
      }
    }

    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text.startsWith("@tauri-apps/")
      ) {
        addCount(tauriImports, file.path);
      }

      if (ts.isCallExpression(node)) {
        const isNamedInvoke =
          ts.isIdentifier(node.expression) && namedInvokes.has(node.expression.text);
        const isNamespaceInvoke =
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          coreNamespaces.has(node.expression.expression.text) &&
          node.expression.name.text === "invoke";
        if (isNamedInvoke || isNamespaceInvoke) addCount(directInvokes, file.path);
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return {
    tauriImports: usageEntries(tauriImports),
    directInvokes: usageEntries(directInvokes),
  };
}

function entryMap(entries, label, errors) {
  const result = new Map();
  for (const [file, count] of Object.entries(entries)) {
    if (!Number.isInteger(count) || count < 1) {
      errors.push(`${file} has an invalid count in ${label}`);
    } else {
      result.set(file, count);
    }
  }
  return result;
}

function validateUsageGroup({ actualEntries, allowedEntries, adapters, label, errors }) {
  const actual = new Map(actualEntries.map(({ file, count }) => [file, count]));
  const allowed = entryMap(allowedEntries, `legacy ${label} allowlist`, errors);
  const singular = label === "Tauri imports" ? "Tauri import" : "direct invoke call";

  for (const [file, count] of actual) {
    if (adapters.has(file)) continue;
    const allowance = allowed.get(file);
    if (allowance === undefined) {
      errors.push(
        `${file} has ${count} ${count === 1 ? singular : label} and is not an adapter or temporary exception`,
      );
    } else if (count !== allowance) {
      errors.push(`${file} has ${count} ${count === 1 ? singular : label} but its temporary allowance is ${allowance}`);
    }
  }

  for (const file of allowed.keys()) {
    if (adapters.has(file)) {
      errors.push(`${file} is an adapter; remove its temporary ${label} exception`);
    } else if (!actual.has(file)) {
      errors.push(`${file} no longer has ${label}; remove its temporary exception`);
    }
  }
}

export function validateBoundaryUsage(usage, allowlist) {
  const errors = [];
  if (allowlist.schemaVersion !== 1) {
    errors.push(`Unsupported boundary allowlist schema version: ${String(allowlist.schemaVersion)}`);
  }

  const adapters = new Set();
  for (const file of allowlist.adapterFiles) {
    if (adapters.has(file)) errors.push(`${file} is duplicated in the adapter allowlist`);
    adapters.add(file);
  }

  validateUsageGroup({
    actualEntries: usage.tauriImports,
    allowedEntries: allowlist.legacyTauriImports,
    adapters,
    label: "Tauri imports",
    errors,
  });
  validateUsageGroup({
    actualEntries: usage.directInvokes,
    allowedEntries: allowlist.legacyDirectInvokes,
    adapters,
    label: "direct invoke calls",
    errors,
  });

  return errors;
}

function listFrontendFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFrontendFiles(absolute));
    } else if (
      /\.(?:[jt]sx?)$/.test(entry.name) &&
      !/\.(?:test|spec)\.[jt]sx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push({
        path: path.relative(ROOT, absolute).split(path.sep).join("/"),
        source: fs.readFileSync(absolute, "utf8"),
      });
    }
  }
  return files;
}

export function collectFrontendBoundaryUsage() {
  return collectBoundaryUsage(listFrontendFiles(path.join(ROOT, FRONTEND_ROOT)));
}

function run() {
  if (process.argv.length > 2 && process.argv[2] !== "--check") {
    console.error("Usage: node scripts/check-web-ui-frontend-boundaries.mjs [--check]");
    process.exitCode = 2;
    return;
  }

  const usage = collectFrontendBoundaryUsage();
  const allowlist = JSON.parse(
    fs.readFileSync(path.join(ROOT, ALLOWLIST_PATH), "utf8"),
  );
  const errors = validateBoundaryUsage(usage, allowlist);
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  const importCount = usage.tauriImports.reduce((total, entry) => total + entry.count, 0);
  const invokeCount = usage.directInvokes.reduce((total, entry) => total + entry.count, 0);
  console.log(
    `Frontend boundaries are current: ${importCount} Tauri imports and ${invokeCount} direct invoke calls are adapter-owned or temporarily allowlisted.`,
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) run();
