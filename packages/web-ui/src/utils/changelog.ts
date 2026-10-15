export interface ChangelogEntry {
  version: string;
  date: string;
  url: string | null;
  features: string[];
  bugFixes: string[];
  breakingChanges: string[];
}

/**
 * Trim conventional-changelog noise from a bullet line while keeping any
 * inline markdown (links, `code`, **bold**) intact so it can be rendered
 * downstream with a real markdown renderer.
 * e.g. "**notebook:** add AI buttons ([d0ccee9](…))" → "Add AI buttons"
 */
function cleanLine(raw: string): string {
  let line = raw.replace(/^\*\s*/, "").trim();
  // Remove trailing commit link: ([hash](url))
  line = line.replace(/\s*\(\[[a-f0-9]+\]\([^)]+\)\)\s*$/, "").trim();
  // Remove scope prefix: **scope:** (colon is inside the bold markers)
  line = line.replace(/^\*\*[^*]+:\*\*\s*/, "").trim();
  // Capitalize first letter
  if (line.length > 0) {
    line = line.charAt(0).toUpperCase() + line.slice(1);
  }
  return line;
}

/**
 * Parse conventional-changelog markdown into structured entries.
 */
export function parseChangelog(
  markdown: string,
  links: Record<string, string>,
): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const versionRegex =
    /^#{1,2} \[([^\]]+)\]\([^)]*\)\s*\((\d{4}-\d{2}-\d{2})\)/;
  const sectionRegex = /^### (.+)/;

  let current: ChangelogEntry | null = null;
  let section: "features" | "bugFixes" | "breakingChanges" | null = null;

  for (const line of markdown.split("\n")) {
    const versionMatch = line.match(versionRegex);
    if (versionMatch) {
      if (current) entries.push(current);
      const version = versionMatch[1];
      current = {
        version,
        date: versionMatch[2],
        url: links[version] ?? null,
        features: [],
        bugFixes: [],
        breakingChanges: [],
      };
      section = null;
      continue;
    }

    const sectionMatch = line.match(sectionRegex);
    if (sectionMatch && current) {
      const heading = sectionMatch[1].trim().toLowerCase();
      if (heading === "features") section = "features";
      else if (heading === "bug fixes") section = "bugFixes";
      else if (heading === "breaking changes") section = "breakingChanges";
      else section = null;
      continue;
    }

    if (current && section && line.startsWith("* ")) {
      current[section].push(cleanLine(line));
    }
  }

  if (current) entries.push(current);
  return entries;
}
