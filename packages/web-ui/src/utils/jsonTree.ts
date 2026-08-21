import type { JsonData } from "json-edit-react";

export { isJsonColumn } from "./json";

export type JsonTreeData = JsonData;

export interface SafeParseResult {
  value: unknown;
  error?: string;
}

export function safeParse(text: string): SafeParseResult {
  if (text.trim() === "") return { value: null };
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    const message = e instanceof SyntaxError ? e.message : "Invalid JSON";
    return { value: null, error: message };
  }
}
