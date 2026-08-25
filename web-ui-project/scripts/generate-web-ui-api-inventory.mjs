#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FRONTEND_ROOT = "packages/web-ui/src";
const TAURI_HANDLER_PATH = "src-tauri/src/lib.rs";
const INVENTORY_PATH = "web-ui-project/docs/web-ui-parity.json";

const CLASSIFICATION_VALUES = {
  featureGroup: [
    "ai",
    "application",
    "backup",
    "configuration",
    "connections",
    "data",
    "database-objects",
    "drivers",
    "files",
    "k8s",
    "logs",
    "metadata",
    "notebooks",
    "plugins",
    "queries",
    "saved-queries",
    "ssh",
    "tasks",
    "themes",
    "users",
    "windows",
  ],
  eventUse: ["none", "emits", "event-coordinated"],
  filesystemUse: ["none", "read", "write", "read-write"],
  authorizationLevel: ["session", "database", "sensitive", "local-admin"],
};

function scriptKind(filePath) {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function invocationAliases(sourceFile) {
  const named = new Set();
  const namespaces = new Set();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@tauri-apps/api/core" ||
      !statement.importClause
    ) {
      continue;
    }

    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === "invoke") {
          named.add(element.name.text);
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
  }

  return { named, namespaces };
}

function isInvokeCall(node, aliases) {
  if (!ts.isCallExpression(node)) return false;
  if (ts.isIdentifier(node.expression)) return aliases.named.has(node.expression.text);
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    aliases.namespaces.has(node.expression.expression.text) &&
    node.expression.name.text === "invoke"
  );
}

function literalCommand(argument) {
  let current = argument;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text;
  }
  return null;
}

function enclosingFunctionName(node) {
  let current = node.parent;
  while (current) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) &&
      current.name
    ) {
      return current.name.getText();
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parent &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    current = current.parent;
  }
  return null;
}

function variableInitializers(sourceFile) {
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const entries = declarations.get(node.name.text) ?? [];
      entries.push(node);
      declarations.set(node.name.text, entries);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return declarations;
}

function expressionStringLiterals(node, declarations) {
  const literals = new Set();
  const resolvedDeclarations = new Set();
  const anchor = node.getStart();

  function visit(current) {
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      literals.add(current.text);
      return;
    }
    if (ts.isIdentifier(current)) {
      const declaration = (declarations.get(current.text) ?? [])
        .filter((candidate) => candidate.getStart() < anchor)
        .at(-1);
      if (declaration && !resolvedDeclarations.has(declaration)) {
        resolvedDeclarations.add(declaration);
        visit(declaration.initializer);
      }
      return;
    }
    if (ts.isPropertyAssignment(current)) {
      visit(current.initializer);
      return;
    }
    ts.forEachChild(current, visit);
  }

  visit(node);
  return [...literals].sort();
}

export function extractFrontendInvocations(files) {
  const literalInvocations = [];
  const dynamicInvocations = [];

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const sourceFile = ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(file.path),
    );
    const aliases = invocationAliases(sourceFile);
    const declarations = variableInitializers(sourceFile);

    function visit(node) {
      if (isInvokeCall(node, aliases) && node.arguments.length > 0) {
        const argument = node.arguments[0];
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const command = literalCommand(argument);
        if (command === null) {
          dynamicInvocations.push({
            expression: argument.getText(sourceFile).replace(/\s+/g, " "),
            file: file.path,
            line,
            context: enclosingFunctionName(node),
            possibleCommands: expressionStringLiterals(argument, declarations),
          });
        } else {
          literalInvocations.push({ command, file: file.path, line });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return { literalInvocations, dynamicInvocations };
}

function findMacroBody(source) {
  const marker = "tauri::generate_handler!";
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) throw new Error("Tauri generate_handler! macro was not found");
  const openIndex = source.indexOf("[", markerIndex + marker.length);
  if (openIndex === -1) throw new Error("Tauri generate_handler! macro has no body");

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }

  throw new Error("Tauri generate_handler! macro body is not closed");
}

export function extractTauriHandlers(source) {
  const body = findMacroBody(source)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const handlers = body
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (!/^(?:[A-Za-z_]\w*::)*[A-Za-z_]\w*$/.test(entry)) {
        throw new Error(`Unsupported Tauri handler registration: ${entry}`);
      }
      return entry.split("::").at(-1);
    });

  return handlers;
}

function classificationFor(command, previousCommands) {
  const previous = previousCommands.get(command);
  return {
    featureGroup: previous?.featureGroup ?? null,
    eventUse: previous?.eventUse ?? null,
    filesystemUse: previous?.filesystemUse ?? null,
    authorizationLevel: previous?.authorizationLevel ?? null,
  };
}

function dynamicInvocationKey(invocation) {
  return `${invocation.file}\0${invocation.context ?? ""}\0${invocation.expression}`;
}

function dynamicClassificationFor(invocation, previousDynamic) {
  const previous = previousDynamic.get(dynamicInvocationKey(invocation));
  return {
    ...invocation,
    possibleCommands:
      invocation.possibleCommands.length > 0
        ? invocation.possibleCommands
        : (previous?.possibleCommands ?? []),
    featureGroup: previous?.featureGroup ?? null,
    eventUse: previous?.eventUse ?? null,
    filesystemUse: previous?.filesystemUse ?? null,
    authorizationLevel: previous?.authorizationLevel ?? null,
  };
}

export function buildInventory({ frontend, handlers, previous = {} }) {
  const previousCommands = new Map((previous.commands ?? []).map((command) => [command.name, command]));
  const previousDynamic = new Map(
    (previous.dynamicInvocations ?? []).map((invocation) => [
      dynamicInvocationKey(invocation),
      invocation,
    ]),
  );
  const handlerSet = new Set(handlers);
  const duplicateHandlerRegistrations = [
    ...new Set(handlers.filter((handler, index) => handlers.indexOf(handler) !== index)),
  ].sort();
  const callsByCommand = new Map();

  for (const invocation of frontend.literalInvocations) {
    const callSites = callsByCommand.get(invocation.command) ?? [];
    callSites.push({ file: invocation.file, line: invocation.line });
    callsByCommand.set(invocation.command, callSites);
  }

  const commands = [...callsByCommand]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, callSites]) => ({
      name,
      ...classificationFor(name, previousCommands),
      registered: handlerSet.has(name),
      callSites,
    }));
  const frontendNames = new Set(commands.map((command) => command.name));
  const registeredCommandsWithoutFrontendCall = [...handlerSet]
    .filter((handler) => !frontendNames.has(handler))
    .sort();
  const frontendCommandsMissingRegistration = commands
    .filter((command) => !command.registered)
    .map((command) => command.name);
  const dynamicInvocations = frontend.dynamicInvocations.map((invocation) => {
    const classified = dynamicClassificationFor(invocation, previousDynamic);
    return {
      ...classified,
      unregisteredPossibleCommands: classified.possibleCommands.filter(
        (command) => !handlerSet.has(command),
      ),
    };
  });

  return {
    schemaVersion: 1,
    generatedBy: "pnpm web:inventory:write",
    sources: {
      frontend: FRONTEND_ROOT,
      tauriHandler: TAURI_HANDLER_PATH,
    },
    classifications: CLASSIFICATION_VALUES,
    classificationNotes: {
      eventUse: "Whether command completion or progress participates in the frontend event bus.",
      filesystemUse:
        "User-visible host filesystem access only; internal application persistence is classified as none.",
      authorizationLevel:
        "Minimum intended web authorization scope; all levels still require an authenticated session.",
    },
    summary: {
      literalCommandCount: commands.length,
      literalCallSiteCount: frontend.literalInvocations.length,
      dynamicCallSiteCount: dynamicInvocations.length,
      handlerRegistrationCount: handlers.length,
      registeredCommandCount: handlerSet.size,
      duplicateHandlerRegistrations,
      frontendCommandsMissingRegistration,
      registeredCommandsWithoutFrontendCall: registeredCommandsWithoutFrontendCall.length,
    },
    commands,
    dynamicInvocations,
    registeredCommandsWithoutFrontendCall,
  };
}

export function validateInventory(inventory) {
  const errors = [];
  const commands = inventory.commands ?? [];
  const seen = new Set();

  for (const command of commands) {
    if (seen.has(command.name)) errors.push(`Command ${command.name} is duplicated`);
    seen.add(command.name);
    for (const field of Object.keys(CLASSIFICATION_VALUES)) {
      if (command[field] === null || command[field] === undefined) {
        errors.push(`Command ${command.name} is missing ${field} classification`);
      } else if (!CLASSIFICATION_VALUES[field].includes(command[field])) {
        errors.push(`Command ${command.name} has invalid ${field} classification: ${command[field]}`);
      }
    }
    if (!command.registered) {
      errors.push(`Frontend command ${command.name} is not registered by the Tauri handler`);
    }
  }

  for (const invocation of inventory.dynamicInvocations ?? []) {
    const label = `${invocation.file}:${invocation.line} (${invocation.expression})`;
    if (!Array.isArray(invocation.possibleCommands) || invocation.possibleCommands.length === 0) {
      errors.push(`Dynamic invocation ${label} has no inventoried possible commands`);
    }
    for (const command of invocation.unregisteredPossibleCommands ?? []) {
      errors.push(`Dynamic invocation ${label} may call unregistered command ${command}`);
    }
    for (const field of Object.keys(CLASSIFICATION_VALUES)) {
      if (invocation[field] === null || invocation[field] === undefined) {
        errors.push(`Dynamic invocation ${label} is missing ${field} classification`);
      } else if (!CLASSIFICATION_VALUES[field].includes(invocation[field])) {
        errors.push(`Dynamic invocation ${label} has invalid ${field} classification: ${invocation[field]}`);
      }
    }
  }

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

function readPreviousInventory() {
  const inventoryPath = path.join(ROOT, INVENTORY_PATH);
  if (!fs.existsSync(inventoryPath)) return {};
  return JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
}

function generateInventory() {
  const frontend = extractFrontendInvocations(listFrontendFiles(path.join(ROOT, FRONTEND_ROOT)));
  const handlers = extractTauriHandlers(fs.readFileSync(path.join(ROOT, TAURI_HANDLER_PATH), "utf8"));
  return buildInventory({ frontend, handlers, previous: readPreviousInventory() });
}

function formatInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function run() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--write"].includes(mode)) {
    console.error("Usage: node web-ui-project/scripts/generate-web-ui-api-inventory.mjs [--check|--write]");
    process.exitCode = 2;
    return;
  }

  const inventory = generateInventory();
  const formatted = formatInventory(inventory);
  const errors = validateInventory(inventory);
  const inventoryPath = path.join(ROOT, INVENTORY_PATH);

  if (mode === "--write") {
    fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
    fs.writeFileSync(inventoryPath, formatted);
  } else {
    const current = fs.existsSync(inventoryPath) ? fs.readFileSync(inventoryPath, "utf8") : "";
    if (current !== formatted) {
      errors.push(`Inventory is stale; run pnpm web:inventory:write and classify new entries`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Web UI API inventory is current: ${inventory.summary.literalCommandCount} commands, ` +
      `${inventory.summary.literalCallSiteCount} call sites, ${inventory.summary.dynamicCallSiteCount} dynamic calls, ` +
      `${inventory.summary.registeredCommandCount} registered handlers.`,
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) run();
