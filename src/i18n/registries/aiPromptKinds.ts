import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const aiPromptLabel: Record<string, MessageDescriptor> = {
  system: msg`SQL Generation`,
  explain: msg`Query Explanation`,
  cellname: msg`Notebook Cell Name Prompt`,
  tabrename: msg`Query Tab Name Prompt`,
  explainplan: msg`Explain Plan Analysis Prompt`,
};

export const aiPromptDesc: Record<string, MessageDescriptor> = {
  system: msg`Instructions for AI-powered SQL generation. Use {{SCHEMA}} as a placeholder for the database structure.`,
  explain: msg`Instructions for AI-powered query explanation. Use {{LANGUAGE}} as a placeholder for the output language.`,
  cellname: msg`Customize instructions for AI notebook cell name generation. The cell content (SQL or Markdown) is sent as the user message.`,
  tabrename: msg`Customize instructions for AI query result tab name generation. The SQL query is sent as the user message.`,
  explainplan: msg`Customize instructions for AI analysis of EXPLAIN query plans. Use {{LANGUAGE}} for the output language.`,
};

export const aiPromptPlaceholder: Record<string, MessageDescriptor> = {
  system: msg`Enter system prompt...`,
  explain: msg`Enter explain prompt...`,
  cellname: msg`Enter notebook cell name prompt...`,
  tabrename: msg`Enter query tab name prompt...`,
  explainplan: msg`Enter explain plan analysis prompt...`,
};
