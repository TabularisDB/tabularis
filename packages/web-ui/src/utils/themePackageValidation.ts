import Ajv, { type ValidateFunction } from "ajv";
import { getNodeValue, parseTree, visit, printParseErrorCode } from "jsonc-parser";
import { valid, gte } from "semver";
import definitionSchema from "../schemas/theme-definition-v1.json";
import manifestSchema from "../schemas/theme-package-v1.json";
import limits from "../schemas/theme-limits-v1.json";
import type { ThemeDefinitionV1, ThemePackageManifestV1 } from "../types/themePackage";
import { isThemePackagePath, isThemePackageSlug, themePackageId } from "./themePackageIdentity";

export const THEME_INPUT_LIMITS = Object.freeze(limits);

const ajv = new Ajv({ allErrors: false, strict: true, ownProperties: true });
const versionPattern = new RegExp(manifestSchema.properties.version.pattern);
let definitionValidator: ValidateFunction<ThemeDefinitionV1> | undefined;
let manifestValidator: ValidateFunction<ThemePackageManifestV1> | undefined;

function assertUnicode(value: string): void {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point >= 0xd800 && point <= 0xdfff) throw new Error("Invalid Unicode in theme JSON");
  }
}

/** Bound input before allocation/recursion and reject duplicate decoded keys. */
export function parseBoundedThemeJson(source: string, maxBytes: number): unknown {
  return parseBoundedSource(source, maxBytes, false);
}

/** Separate import-only entry point; package definitions remain strict JSON. */
export function parseBoundedJsoncTheme(source: string): unknown {
  return parseBoundedSource(source, limits.definitionBytes, true);
}

function parseBoundedSource(source: string, maxBytes: number, jsonc: boolean): unknown {
  if (source.length > maxBytes || new TextEncoder().encode(source).length > maxBytes) {
    throw new Error("Theme JSON exceeds the byte limit");
  }
  const stack: Array<Set<string> | null> = [];
  let nodes = 0;
  const count = () => {
    if (++nodes > limits.jsonNodes) throw new Error("Theme JSON exceeds the node limit");
  };
  const enter = (keys: Set<string> | null) => {
    count();
    stack.push(keys);
    if (stack.length > limits.jsonDepth) throw new Error("Theme JSON exceeds the depth limit");
  };
  visit(source, {
    onObjectBegin: () => enter(new Set()),
    onArrayBegin: () => enter(null),
    onObjectProperty: (key) => {
      assertUnicode(key);
      const keys = stack.at(-1);
      if (!keys || keys.has(key)) throw new Error("Duplicate theme JSON property");
      keys.add(key);
    },
    onObjectEnd: () => { stack.pop(); },
    onArrayEnd: () => { stack.pop(); },
    onLiteralValue: (value: unknown) => {
      count();
      if (typeof value === "string") assertUnicode(value);
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid JSON number");
    },
    onError: (error) => { throw new Error(`Invalid theme JSON: ${printParseErrorCode(error)}`); },
  }, { disallowComments: !jsonc, allowTrailingComma: jsonc, allowEmptyContent: false });
  if (!jsonc) return JSON.parse(source) as unknown;
  // jsonc-parser.parse() assigns __proto__ through an ordinary object setter.
  // AST conversion instead creates null-prototype records at every level.
  const tree = parseTree(source, undefined, { allowTrailingComma: true });
  if (!tree) throw new Error("Invalid theme JSONC document");
  return getNodeValue(tree) as unknown;
}

/** New-format-only validation; legacy personal themes must use their adapter. */
export function parseThemeDefinition(source: string): ThemeDefinitionV1 {
  const value = parseBoundedThemeJson(source, limits.definitionBytes);
  definitionValidator ??= ajv.compile<ThemeDefinitionV1>(definitionSchema);
  if (!definitionValidator(value)) {
    throw new Error(`Invalid theme definition: ${ajv.errorsText(definitionValidator.errors)}`);
  }
  return value;
}

export function parseThemePackageManifest(source: string): ThemePackageManifestV1 {
  const value = parseBoundedThemeJson(source, limits.manifestBytes);
  manifestValidator ??= ajv.compile<ThemePackageManifestV1>(manifestSchema);
  if (!manifestValidator(value)) {
    throw new Error(`Invalid theme package: ${ajv.errorsText(manifestValidator.errors)}`);
  }
  if (!valid(value.version) || !valid(value.min_runtime_version)) {
    throw new Error("Theme package versions must be canonical exact SemVer");
  }
  themePackageId(value);
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const variant of value.theme_variants) {
    if (!isThemePackageSlug(variant.id) || ids.has(variant.id)) {
      throw new Error("Invalid or duplicate theme variant ID");
    }
    if (!isThemePackagePath(variant.file) || paths.has(variant.file.toLowerCase())) {
      throw new Error("Invalid or colliding theme definition path");
    }
    ids.add(variant.id);
    paths.add(variant.file.toLowerCase());
  }
  return value;
}

/** No development-build bypass or permissive legacy-driver version fallback. */
export function assertThemeRuntimeVersion(manifest: ThemePackageManifestV1, hostVersion: string): void {
  if (!versionPattern.test(hostVersion) || !valid(hostVersion) || !gte(hostVersion, manifest.min_runtime_version)) {
    throw new Error(`Theme package requires Tabularis ${manifest.min_runtime_version} or newer`);
  }
}
