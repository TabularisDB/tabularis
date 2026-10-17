import * as explainApi from "@tabularis/explain";
import type { ExplainPlan, RegisteredExplainParser } from "@tabularis/explain";

import { connectFrame, pluginFrameUrl } from "../plugins/sandbox/connectFrame";
import type { RpcPort } from "../plugins/sandbox/rpc";
import type { ExplainParserManifestEntry, PluginManifest } from "../types/plugins";

type ContinueLoading = () => boolean;

interface ParserDescriptor {
  engine: string;
  format: string;
  label?: string;
  hasSniff: boolean;
}

interface SandboxSession {
  frame: HTMLIFrameElement;
  rpc: RpcPort;
  refCount: number;
  close: () => void;
}

const sessionsByFormat = new Map<string, SandboxSession>();

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

function isParserDescriptor(value: unknown): value is ParserDescriptor {
  return (
    isRecord(value) &&
    isNonEmptyString(value.engine) &&
    isNonEmptyString(value.format) &&
    (value.label === undefined || isNonEmptyString(value.label)) &&
    typeof value.hasSniff === "boolean"
  );
}

async function createSandboxSession(
  pluginId: string,
  modulePath: string,
  shouldContinue: ContinueLoading,
): Promise<{ session: SandboxSession; parsers: ParserDescriptor[] }> {
  const frame = document.createElement("iframe");
  frame.title = `EXPLAIN parser ${pluginId}`;
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.display = "none";
  frame.src = pluginFrameUrl(pluginId, modulePath, "explain");
  document.body.append(frame);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  const cancellationPoll = window.setInterval(() => {
    if (!shouldContinue()) controller.abort();
  }, 50);
  let rpc: RpcPort | undefined;
  try {
    rpc = await connectFrame(frame, {}, controller.signal);
    if (!shouldContinue()) throw new DOMException("Plugin loading cancelled", "AbortError");
    const raw = await rpc.call("explain.load", [modulePath]);
    if (!Array.isArray(raw) || !raw.every(isParserDescriptor)) {
      throw new Error("Plugin parser bundle returned invalid metadata");
    }
    const session: SandboxSession = {
      frame,
      rpc,
      refCount: 0,
      close: () => {
        rpc?.close();
        frame.remove();
      },
    };
    return { session, parsers: raw };
  } catch (error) {
    rpc?.close();
    frame.remove();
    throw error;
  } finally {
    window.clearTimeout(timeout);
    window.clearInterval(cancellationPoll);
  }
}

/**
 * Load and register EXPLAIN parsers declared by an installed plugin.
 * Bundles run only in hidden sandboxed guest frames; the host receives parser
 * metadata and communicates with parser functions through the limited RPC.
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

  const parsersByModule = new Map<string, ParserDescriptor[]>();
  const sessionByModule = new Map<string, SandboxSession>();
  for (const modulePath of entriesByModule.keys()) {
    if (!shouldContinue()) break;
    try {
      const { session, parsers } = await createSandboxSession(
        manifest.id,
        modulePath,
        shouldContinue,
      );
      if (!shouldContinue()) {
        session.close();
        break;
      }
      parsersByModule.set(modulePath, parsers);
      sessionByModule.set(modulePath, session);
    } catch (error) {
      console.error(
        `[PluginExplain] Failed to load module "${modulePath}" for plugin "${manifest.id}":`,
        error,
      );
    }
  }

  const declaredParsersByModule = new Map<string, Set<string>>();
  const registeredFormats: string[] = [];
  const registeredFormatSet = new Set<string>();
  for (const entry of validEntries) {
    if (!shouldContinue()) break;
    if (registeredFormatSet.has(entry.format)) continue;

    const parsers = parsersByModule.get(entry.module);
    const session = sessionByModule.get(entry.module);
    if (parsers === undefined || session === undefined) continue;

    const matches = parsers.filter(
      (parser) => parser.engine === entry.engine && parser.format === entry.format,
    );
    if (matches.length !== 1) {
      console.warn(
        `[PluginExplain] Plugin "${manifest.id}" module "${entry.module}" must export exactly one parser for engine "${entry.engine}" and format "${entry.format}". Skipping.`,
      );
      continue;
    }

    const descriptor = matches[0];
    const parser: RegisteredExplainParser = {
      engine: descriptor.engine,
      format: descriptor.format,
      ...(entry.label ?? descriptor.label
        ? { label: entry.label ?? descriptor.label }
        : {}),
      parse: async (payload: string): Promise<ExplainPlan> =>
        (await session.rpc.call("explain.parse", [descriptor.format, payload])) as ExplainPlan,
      ...(descriptor.hasSniff
        ? {
            sniff: async (payload: string): Promise<boolean> =>
              (await session.rpc.call("explain.sniff", [descriptor.format, payload])) === true,
          }
        : {}),
    };

    try {
      explainApi.registerExplainParser(parser);
      const replacedSession = sessionsByFormat.get(entry.format);
      if (replacedSession && replacedSession !== session) {
        replacedSession.refCount -= 1;
        if (replacedSession.refCount <= 0) replacedSession.close();
      }
      session.refCount += 1;
      sessionsByFormat.set(entry.format, session);
      registeredFormatSet.add(entry.format);
      const declared = declaredParsersByModule.get(entry.module) ?? new Set<string>();
      declared.add(entry.format);
      declaredParsersByModule.set(entry.module, declared);
      registeredFormats.push(entry.format);
    } catch (error) {
      console.warn(
        `[PluginExplain] Plugin "${manifest.id}" module "${entry.module}" could not register parser format "${entry.format}". Skipping.`,
        error,
      );
    }
  }

  for (const [modulePath, parsers] of parsersByModule) {
    const declared = declaredParsersByModule.get(modulePath);
    for (const parser of parsers) {
      if (!declared?.has(parser.format)) {
        console.warn(
          `[PluginExplain] Plugin "${manifest.id}" module "${modulePath}" exported undeclared parser format "${parser.format}". Skipping.`,
        );
      }
    }
  }

  for (const [modulePath, session] of sessionByModule) {
    if (session.refCount === 0) session.close();
    sessionByModule.delete(modulePath);
  }

  return registeredFormats;
}

/** Unregister formats and close the hidden guest frames that serve them. */
export function disposePluginExplainParsers(formats: Iterable<string>): void {
  const sessionsToClose = new Set<SandboxSession>();
  for (const format of formats) {
    explainApi.unregisterExplainParser(format);
    const session = sessionsByFormat.get(format);
    if (!session) continue;
    sessionsByFormat.delete(format);
    session.refCount -= 1;
    if (session.refCount <= 0) sessionsToClose.add(session);
  }
  for (const session of sessionsToClose) session.close();
}
