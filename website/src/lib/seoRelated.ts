export interface RelatedLink {
  href: string;
  label: string;
}

const TAG_TO_LINKS: Record<string, RelatedLink[]> = {
  notebooks: [
    { href: "/solutions/sql-notebooks", label: "SQL notebooks guide" },
    { href: "/wiki/notebooks", label: "Notebook documentation" },
  ],
  analysis: [
    { href: "/solutions/sql-notebooks", label: "SQL notebooks guide" },
    { href: "/compare/dbeaver-alternative", label: "DBeaver alternative" },
  ],
  charts: [
    { href: "/solutions/sql-notebooks", label: "SQL notebooks guide" },
    { href: "/wiki/notebooks", label: "Notebook documentation" },
  ],
  mcp: [
    { href: "/solutions/mcp-database-client", label: "MCP database client guide" },
    { href: "/wiki/mcp-server", label: "MCP setup documentation" },
  ],
  ai: [
    { href: "/solutions/mcp-database-client", label: "MCP database client guide" },
    { href: "/wiki/ai-assistant", label: "AI assistant documentation" },
  ],
  productivity: [
    { href: "/solutions/mcp-database-client", label: "MCP database client guide" },
    { href: "/wiki/ai-assistant", label: "AI assistant documentation" },
  ],
  sql: [
    { href: "/solutions/postgresql-client", label: "PostgreSQL client guide" },
    { href: "/wiki/editor", label: "SQL editor documentation" },
  ],
  postgres: [
    { href: "/solutions/postgresql-client", label: "PostgreSQL client guide" },
    { href: "/compare/datagrip-alternative", label: "DataGrip alternative" },
  ],
  mysql: [
    { href: "/solutions/mysql-client-for-developers", label: "MySQL client guide" },
    { href: "/compare/tableplus-alternative", label: "TablePlus alternative" },
  ],
  connections: [
    { href: "/solutions/ssh-database-client", label: "SSH database client guide" },
    { href: "/wiki/connections", label: "Connection management documentation" },
  ],
  databases: [
    { href: "/solutions/postgresql-client", label: "PostgreSQL client guide" },
    { href: "/solutions/sqlite-client-for-developers", label: "SQLite client guide" },
  ],
  "multi-query": [
    { href: "/solutions/sql-notebooks", label: "SQL notebooks guide" },
    { href: "/wiki/editor", label: "SQL editor documentation" },
  ],
  "query-builder": [
    { href: "/wiki/visual-query-builder", label: "Visual query builder docs" },
    { href: "/compare/tableplus-alternative", label: "TablePlus alternative" },
  ],
  schema: [
    { href: "/wiki/schema-management", label: "Schema management docs" },
    { href: "/solutions/postgresql-client", label: "PostgreSQL client guide" },
  ],
  ddl: [
    { href: "/wiki/schema-management", label: "Schema management docs" },
    { href: "/compare/dbeaver-alternative", label: "DBeaver alternative" },
  ],
  "data-grid": [
    { href: "/wiki/data-grid", label: "Data grid documentation" },
    { href: "/solutions/sqlite-client-for-developers", label: "SQLite client guide" },
  ],
  dump: [
    { href: "/wiki/dump-import", label: "Dump and import docs" },
    { href: "/solutions/ssh-database-client", label: "SSH database client guide" },
  ],
  security: [
    { href: "/wiki/security-credentials", label: "Security and credentials docs" },
    { href: "/solutions/ssh-database-client", label: "SSH database client guide" },
  ],
  keychain: [
    { href: "/wiki/security-credentials", label: "Security and credentials docs" },
    { href: "/solutions/ssh-database-client", label: "SSH database client guide" },
  ],
  "open-source": [
    { href: "/solutions/open-source-database-client-linux", label: "Linux database client guide" },
    { href: "/compare/dbgate-alternative", label: "DbGate alternative" },
  ],
  plugins: [
    { href: "/plugins", label: "Plugin registry" },
    { href: "/wiki/plugins", label: "Plugin documentation" },
  ],
  plugin: [
    { href: "/plugins", label: "Plugin registry" },
    { href: "/wiki/plugins", label: "Plugin documentation" },
  ],
  extensibility: [
    { href: "/plugins", label: "Plugin registry" },
    { href: "/compare/dbgate-alternative", label: "DbGate alternative" },
  ],
  architecture: [
    { href: "/wiki/architecture", label: "Architecture documentation" },
    { href: "/plugins", label: "Plugin registry" },
  ],
  nosql: [
    { href: "/solutions/duckdb-redis-database-workflows", label: "DuckDB and Redis workflows" },
    { href: "/compare/beekeeper-studio-alternative", label: "Beekeeper Studio alternative" },
  ],
  redis: [
    { href: "/solutions/duckdb-redis-database-workflows", label: "DuckDB and Redis workflows" },
    { href: "/compare/beekeeper-studio-alternative", label: "Beekeeper Studio alternative" },
  ],
  duckdb: [
    { href: "/solutions/duckdb-redis-database-workflows", label: "DuckDB and Redis workflows" },
    { href: "/compare/dbgate-alternative", label: "DbGate alternative" },
  ],
  community: [
    { href: "/download", label: "Download Tabularis" },
    { href: "/compare/dbeaver-alternative", label: "DBeaver alternative" },
  ],
  visual: [
    { href: "/wiki/visual-query-builder", label: "Visual query builder docs" },
  ],
  ux: [
    { href: "/compare/tableplus-alternative", label: "TablePlus alternative" },
    { href: "/compare/datagrip-alternative", label: "DataGrip alternative" },
  ],
};

const WIKI_TO_LINKS: Record<string, RelatedLink[]> = {
  editor: [
    { href: "/solutions/postgresql-client", label: "PostgreSQL client guide" },
    { href: "/solutions/sqlite-client-for-developers", label: "SQLite client guide" },
  ],
  notebooks: [
    { href: "/solutions/sql-notebooks", label: "SQL notebooks guide" },
    { href: "/compare/dbeaver-alternative", label: "DBeaver alternative" },
  ],
  "mcp-server": [
    { href: "/solutions/mcp-database-client", label: "MCP database client guide" },
    { href: "/compare/datagrip-alternative", label: "DataGrip alternative" },
  ],
  connections: [
    { href: "/solutions/ssh-database-client", label: "SSH database client guide" },
    { href: "/solutions/postgresql-client", label: "PostgreSQL client guide" },
  ],
  "security-credentials": [
    { href: "/solutions/ssh-database-client", label: "SSH database client guide" },
    { href: "/download", label: "Download Tabularis" },
  ],
  "visual-query-builder": [
    { href: "/compare/tableplus-alternative", label: "TablePlus alternative" },
    { href: "/solutions/postgresql-client", label: "PostgreSQL client guide" },
  ],
  "schema-management": [
    { href: "/compare/dbeaver-alternative", label: "DBeaver alternative" },
    { href: "/solutions/postgresql-client", label: "PostgreSQL client guide" },
  ],
  plugins: [
    { href: "/plugins", label: "Plugin registry" },
    { href: "/solutions/plugin-based-database-client", label: "Plugin-based database client" },
  ],
  installation: [
    { href: "/download", label: "Download Tabularis" },
    { href: "/solutions/open-source-database-client-linux", label: "Linux database client guide" },
  ],
};

export function getRelatedLinksForPost(tags: string[]): RelatedLink[] {
  const seen = new Set<string>();
  const links: RelatedLink[] = [];
  for (const tag of tags) {
    for (const link of TAG_TO_LINKS[tag] ?? []) {
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      links.push(link);
    }
  }
  return links.slice(0, 4);
}

export function getRelatedLinksForWiki(slug: string): RelatedLink[] {
  return WIKI_TO_LINKS[slug] ?? [];
}
