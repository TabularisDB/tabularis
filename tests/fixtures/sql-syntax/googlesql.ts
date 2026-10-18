import descriptor from "./googlesql.json";
import type { DriverCapabilities, SqlSyntaxDescriptor } from "../../../src/types/plugins";
import { resolveSqlSyntax } from "../../../src/utils/sqlSyntax";

/** The GoogleSQL `sql_syntax` descriptor the BigQuery plugin ships. */
export const GOOGLESQL_DESCRIPTOR = descriptor as SqlSyntaxDescriptor;

/**
 * Capabilities of the BigQuery plugin: `mysql` as the legacy fallback for
 * hosts without `sql_syntax`, plus the GoogleSQL descriptor.
 */
export const GOOGLESQL_CAPS = {
  identifier_quote: "`",
  sql_dialect: "mysql",
  sql_syntax: GOOGLESQL_DESCRIPTOR,
} as DriverCapabilities;

/** The resolved GoogleSQL syntax, accepted wherever a dialect is. */
export const GOOGLESQL = resolveSqlSyntax(GOOGLESQL_CAPS);
