import type { ExplainPlan } from "./types";
import { BUILTIN_EXPLAIN_PARSERS } from "./parsers/builtins";

export interface RegisteredExplainParser {
  /** Canonical engine id, for example "sqlserver". */
  readonly engine: string;
  /** Globally unique wire-format tag. */
  readonly format: string;
  /** Human label for format pickers. */
  readonly label?: string;
  /** Parse the raw payload or throw an Error. */
  parse(payload: string): ExplainPlan;
  /** Cheap, side-effect-free source detection. */
  sniff?(payload: string): boolean;
}

const builtinParsersByFormat = new Map(
  BUILTIN_EXPLAIN_PARSERS.map((parser) => [parser.format, parser]),
);
const parserOverlays = new Map<string, RegisteredExplainParser>();
const customFormatOrder: string[] = [];

/** Register a custom parser or replace the effective parser for its format. */
export function registerExplainParser(parser: RegisteredExplainParser): void {
  validateParser(parser);

  const replacing = getExplainParser(parser.format) !== null;
  if (replacing) {
    console.warn(
      `EXPLAIN parser format '${parser.format}' is already registered; replacing it.`,
    );
  } else {
    customFormatOrder.push(parser.format);
  }

  parserOverlays.set(parser.format, parser);
}

/** Remove a mutable registration, revealing a built-in parser when overridden. */
export function unregisterExplainParser(format: string): void {
  if (!parserOverlays.delete(format)) return;
  if (builtinParsersByFormat.has(format)) return;

  const index = customFormatOrder.indexOf(format);
  if (index !== -1) customFormatOrder.splice(index, 1);
}

/** Return the effective parser for a format. */
export function getExplainParser(format: string): RegisteredExplainParser | null {
  return parserOverlays.get(format) ?? builtinParsersByFormat.get(format) ?? null;
}

/** Return an immutable snapshot of effective parsers in dispatch order. */
export function listExplainParsers(): readonly RegisteredExplainParser[] {
  const parsers = BUILTIN_EXPLAIN_PARSERS.map(
    (parser) => parserOverlays.get(parser.format) ?? parser,
  );

  for (const format of customFormatOrder) {
    const parser = parserOverlays.get(format);
    if (parser !== undefined) parsers.push(parser);
  }

  return Object.freeze(parsers);
}

function validateParser(parser: RegisteredExplainParser): void {
  if (
    typeof parser !== "object" ||
    parser === null ||
    typeof parser.engine !== "string" ||
    parser.engine.trim() === "" ||
    typeof parser.format !== "string" ||
    parser.format.trim() === "" ||
    typeof parser.parse !== "function"
  ) {
    throw new TypeError(
      "EXPLAIN parser registration requires non-empty engine and format strings and a parse function",
    );
  }
}
