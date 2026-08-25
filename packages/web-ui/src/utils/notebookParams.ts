import type { NotebookParam } from "../types/notebook";

const PARAM_PATTERN = /@(\w+)/g;
const TEMPLATE_PARAM_PATTERN = /\$\{(\w+)\}/g;

export interface ParamReference {
  match: string;
  name: string;
}

export function extractParamReferences(sql: string): ParamReference[] {
  const refs: ParamReference[] = [];
  let match: RegExpExecArray | null;

  // Extract @name references
  const atRegex = new RegExp(PARAM_PATTERN.source, "g");
  while ((match = atRegex.exec(sql)) !== null) {
    refs.push({ match: match[0], name: match[1] });
  }

  // Extract ${name} template references
  const templateRegex = new RegExp(TEMPLATE_PARAM_PATTERN.source, "g");
  while ((match = templateRegex.exec(sql)) !== null) {
    refs.push({ match: match[0], name: match[1] });
  }

  return refs;
}

export function hasParamReferences(sql: string): boolean {
  return PARAM_PATTERN.test(sql) || TEMPLATE_PARAM_PATTERN.test(sql);
}

export function resolveParams(
  sql: string,
  params: NotebookParam[],
): { sql: string; unresolvedParams: string[] } {
  const refs = extractParamReferences(sql);
  if (refs.length === 0) return { sql, unresolvedParams: [] };

  const paramMap = new Map(params.map((p) => [p.name, p.value]));
  const unresolvedParams: string[] = [];
  let resolvedSql = sql;

  // Process refs in reverse order to avoid index shifting
  const uniqueNames = [...new Set(refs.map((r) => r.name))];
  for (const name of uniqueNames) {
    const value = paramMap.get(name);
    if (value === undefined) {
      unresolvedParams.push(name);
      continue;
    }

    // Replace @name occurrences. The replacer function
    // keeps `$&`, `$'` etc. in the value literal instead of being expanded as
    // replacement patterns.
    resolvedSql = resolvedSql.replace(
      new RegExp(`@${name}\\b`, "g"),
      () => value,
    );

    // Replace ${name} template occurrences
    resolvedSql = resolvedSql.replace(
      new RegExp(`\\$\\{${name}\\}`, "g"),
      () => value,
    );
  }

  return { sql: resolvedSql, unresolvedParams };
}

export function validateParamName(name: string): boolean {
  return /^\w+$/.test(name) && name.length > 0;
}

export function createParam(name: string, value: string): NotebookParam {
  return { name, value };
}

export function updateParam(
  params: NotebookParam[],
  name: string,
  value: string,
): NotebookParam[] {
  return params.map((p) => (p.name === name ? { ...p, value } : p));
}

export function removeParam(
  params: NotebookParam[],
  name: string,
): NotebookParam[] {
  return params.filter((p) => p.name !== name);
}

export function addParam(
  params: NotebookParam[],
  param: NotebookParam,
): NotebookParam[] {
  if (params.some((p) => p.name === param.name)) return params;
  return [...params, param];
}
