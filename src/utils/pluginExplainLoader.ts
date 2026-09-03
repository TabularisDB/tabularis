import { invoke } from "@tauri-apps/api/core";
import * as explainApi from "@tabularis/explain";
import type { RegisteredExplainParser } from "@tabularis/explain";

import type { ExplainParserManifestEntry, PluginManifest } from "../types/plugins";

type ContinueLoading = () => boolean;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidManifestEntry(entry: ExplainParserManifestEntry): boolean {
  return (
    isNonEmptyString(entry.engine) &&
    isNonEmptyString(entry.format) &&
    isNonEmptyString(entry.module) &&
    (entry.label === undefined || isNonEmptyString(entry.label))
  );
}

function toRegisteredParser(value: unknown): RegisteredExplainParser | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.engine) ||
    !isNonEmptyString(value.format) ||
    typeof value.parse !== "function" ||
    (value.label !== undefined && !isNonEmptyString(value.label)) ||
    (value.sniff !== undefined && typeof value.sniff !== "function")
  ) {
    return null;
  }

  return {
    engine: value.engine,
    format: value.format,
    ...(value.label === undefined ? {} : { label: value.label }),
    parse: value.parse as RegisteredExplainParser["parse"],
    ...(value.sniff === undefined
      ? {}
      : { sniff: value.sniff as NonNullable<RegisteredExplainParser["sniff"]> }),
  };
}

function getBundleExports(raw: unknown): unknown[] {
  const exported =
    isRecord(raw) && Object.prototype.hasOwnProperty.call(raw, "default") ? raw.default : raw;
  if (exported === null || exported === undefined) return [];
  return Array.isArray(exported) ? exported : [exported];
}

function evaluateBundle(source: string): unknown {
  const evaluate = new Function(
    "__TABULARIS_EXPLAIN__",
    `${source}\nreturn typeof __tabularis_explain_parser__ !== "undefined" ? __tabularis_explain_parser__ : null;`,
  );
  return evaluate(explainApi) as unknown;
}

/**
 * Load and register every EXPLAIN parser declared by one installed plugin.
 *
 * Module files are read and evaluated independently so a broken bundle cannot
 * prevent another parser from loading. The returned formats are the mutable
 * registry overlays created by this call and must be unregistered when the
 * enabled-plugin set changes.
 */
export async function loadPluginExplainParsers(
  manifest: PluginManifest,
  shouldContinue: ContinueLoading = () => true,
): Promise<string[]> {
  if (!manifest.explain_parsers?.length) return [];

  const entriesByModule = new Map<string, ExplainParserManifestEntry[]>();
  const validEntries: ExplainParserManifestEntry[] = [];
  for (const entry of manifest.explain_parsers) {
    if (!isValidManifestEntry(entry)) {
      console.warn(
        `[PluginExplain] Plugin "${manifest.id}" has an invalid EXPLAIN parser manifest entry. Skipping.`,
      );
      continue;
    }
    validEntries.push(entry);
    const entries = entriesByModule.get(entry.module) ?? [];
    entries.push(entry);
    entriesByModule.set(entry.module, entries);
  }

  const parsersByModule = new Map<string, RegisteredExplainParser[]>();
  for (const modulePath of entriesByModule.keys()) {
    if (!shouldContinue()) break;

    let rawExports: unknown;
    try {
      const source = await invoke<string>("read_plugin_file", {
        pluginId: manifest.id,
        filePath: modulePath,
      });
      if (!shouldContinue()) break;
      rawExports = evaluateBundle(source);
    } catch (error) {
      console.error(
        `[PluginExplain] Failed to load module "${modulePath}" for plugin "${manifest.id}":`,
        error,
      );
      continue;
    }

    const parsers: RegisteredExplainParser[] = [];
    for (const value of getBundleExports(rawExports)) {
      const parser = toRegisteredParser(value);
      if (parser === null) {
        console.warn(
          `[PluginExplain] Plugin "${manifest.id}" module "${modulePath}" exported an invalid parser. Skipping.`,
        );
      } else {
        parsers.push(parser);
      }
    }
    parsersByModule.set(modulePath, parsers);
  }

  const declaredParsersByModule = new Map<string, Set<RegisteredExplainParser>>();
  const registeredFormats: string[] = [];
  for (const entry of validEntries) {
    if (!shouldContinue()) break;

    const parsers = parsersByModule.get(entry.module);
    if (parsers === undefined) continue;

    const matches = parsers.filter(
      (parser) => parser.engine === entry.engine && parser.format === entry.format,
    );
    if (matches.length !== 1) {
      console.warn(
        `[PluginExplain] Plugin "${manifest.id}" module "${entry.module}" must export exactly one parser for engine "${entry.engine}" and format "${entry.format}". Skipping.`,
      );
      continue;
    }

    const parser = matches[0];
    try {
      explainApi.registerExplainParser({
        ...parser,
        ...(entry.label === undefined ? {} : { label: entry.label }),
      });
      const declaredParsers = declaredParsersByModule.get(entry.module) ?? new Set();
      declaredParsers.add(parser);
      declaredParsersByModule.set(entry.module, declaredParsers);
      registeredFormats.push(parser.format);
    } catch (error) {
      console.warn(
        `[PluginExplain] Plugin "${manifest.id}" module "${entry.module}" could not register parser format "${entry.format}". Skipping.`,
        error,
      );
    }
  }

  for (const [modulePath, parsers] of parsersByModule) {
    const declaredParsers = declaredParsersByModule.get(modulePath);
    for (const parser of parsers) {
      if (!declaredParsers?.has(parser)) {
        console.warn(
          `[PluginExplain] Plugin "${manifest.id}" module "${modulePath}" exported undeclared parser format "${parser.format}". Skipping.`,
        );
      }
    }
  }

  return registeredFormats;
}
