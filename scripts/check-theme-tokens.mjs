#!/usr/bin/env node
/**
 * Theme token conformance check.
 *
 * Every color, radius and font the UI paints must come from the theme tokens
 * described in DESIGN.md, so that built-in and third-party themes (light,
 * dark, square-cornered, high-contrast) restyle the whole application. This
 * script fails when a source file reintroduces a hardcoded color:
 *
 *   1. Tailwind palette classes such as `text-blue-400` or `bg-red-900/20`
 *   2. hex literals in TypeScript/TSX (`#3b82f6`, `text-[#10a37f]`)
 *   3. `rgb()`/`rgba()`/`hsl()` literals other than neutral black/white shadows
 *   4. `text-white` painted over an accent background (use `text-inverse`)
 *      and `hover:text-white` (use `hover:text-primary`)
 *   5. `text-accent-primary`: accent.primary is a fill; text and icons in the
 *      accent hue use `text-accent` (the theme's text.accent token)
 *   6. focus states colored with `accent-primary` instead of the `focus` token
 *   7. `text-inverse` over a non-primary accent fill (use `text-on-accent-*`)
 *
 * Files whose colors are an identity rather than a theme choice (brand icons,
 * driver colors, user-picked swatches) are listed in ALLOWLIST with the rules
 * they may skip. Add an entry only with a reason; never to silence a UI color.
 *
 * Usage: node scripts/check-theme-tokens.mjs [--verbose] [--github]
 *   --github  also print GitHub Actions annotations, so findings show up on
 *             the pull request diff (the CI workflow passes it).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(ROOT, "src");
const SKIP_DIRS = ["src/themes", "src/schemas", "src/i18n"];
const EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

/** @type {Record<string, { rules: Array<"palette" | "hex" | "rgb" | "white">, reason: string }>} */
const ALLOWLIST = {
  "src/index.css": { rules: ["hex", "rgb"], reason: "Tabularis Dark defaults for :root before a theme is applied" },
  "src/App.css": { rules: ["hex"], reason: "Vite scaffold leftovers, unused by the app" },
  "src/utils/themeResolver.ts": { rules: ["hex"], reason: "theme engine: transparent constant used while resolving definitions" },
  "src/utils/themePackageExport.ts": { rules: ["hex"], reason: "theme engine: transparent constant used while exporting definitions" },
  "src/utils/themeContrast.ts": { rules: ["hex"], reason: "contrast audit: black/white labels derived like --text-on-accent-*" },
  "src/components/icons/ClientIcons.tsx": { rules: ["hex", "palette"], reason: "third-party brand marks" },
  "src/components/icons/BrandIcons.tsx": { rules: ["hex", "palette"], reason: "third-party brand marks" },
  "src/components/icons/DiscordIcon.tsx": { rules: ["hex", "palette"], reason: "Discord brand mark" },
  "src/components/layout/sidebar/DiscordCommunityCallout.tsx": { rules: ["palette", "white"], reason: "Discord-branded callout" },
  "src/utils/notebookHtmlExport.ts": { rules: ["hex", "rgb"], reason: "standalone HTML document rendered outside the app" },
  "src/hooks/useDrivers.ts": { rules: ["hex"], reason: "driver identity colors, shown next to the driver logo" },
  "src/utils/driverUI.tsx": { rules: ["hex"], reason: "neutral fallback for drivers without an identity color" },
  "src/components/modals/NewConnectionModal.tsx": { rules: ["hex"], reason: "database paradigm identity colors" },
  "src/components/modals/connection/InstallGate.tsx": { rules: ["hex"], reason: "database paradigm identity colors" },
  "src/components/modals/connection/EngineCard.tsx": { rules: ["hex"], reason: "database paradigm identity colors" },
  "src/components/modals/NewConnectionModal/palette.ts": { rules: ["hex"], reason: "swatches the user picks for connections and tags" },
  "src/components/modals/NewConnectionModal/AppearanceSection.tsx": { rules: ["hex", "rgb"], reason: "user-picked connection color and its neutral swatch shadows" },
  "src/components/settings/AiTab.tsx": { rules: ["hex"], reason: "AI provider brand marks" },
  "src/pages/McpPage.tsx": { rules: ["hex"], reason: "AI client brand marks" },
  "src/components/modals/McpModal.tsx": { rules: ["hex"], reason: "AI client brand marks" },
  "src/components/settings/InfoTab.tsx": { rules: ["hex"], reason: "fallback when the theme has no surface color yet" },
  "src/components/layout/Sidebar.tsx": { rules: ["hex"], reason: "fallback when the theme has no surface color yet" },
  "src/components/ui/TableToolbar.tsx": { rules: ["rgb"], reason: "neutral black drop shadow" },
};

const FAMILIES =
  "blue|sky|indigo|red|rose|green|emerald|lime|teal|amber|yellow|orange|purple|violet|fuchsia|pink|cyan|slate|gray|zinc|neutral|stone";
const UTILS =
  "bg|text|border-[trblxyse]|border|ring-offset|ring|from|to|via|fill|stroke|shadow|outline|divide|decoration|accent|caret|placeholder";
const PALETTE = new RegExp(`(?<![a-zA-Z0-9-])(?:[a-z-]+:)*(?:${UTILS})-(?:${FAMILIES})-(?:50|[1-9]00|950)(?:/[0-9]{1,3})?(?![a-zA-Z0-9-/])`, "g");
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /\b(?:rgba?|hsla?)\(/g;
const NEUTRAL_RGB = /\brgba?\(\s*(?:0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255|0 0 0|255 255 255)\b/;
const WHITE_ON_ACCENT = /(?<![a-zA-Z0-9-])text-white(?![a-zA-Z0-9-/])/;
const ACCENT_BG = /(?:bg|from)-accent-(?:primary|secondary|success|warning|error|info)/;
const HOVER_WHITE = /(?<![a-zA-Z0-9-])(?:group-hover|hover|focus|active):(?:enabled:)?text-white(?![a-zA-Z0-9-/])/;
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*)/;
const ACCENT_AS_TEXT = /(?<![a-zA-Z0-9-])(?:[a-z-]+:)*text-accent-primary(?![a-zA-Z0-9-])/g;
const ACCENT_FOCUS = /(?<![a-zA-Z0-9-])(?:[a-z-]+:)*(?:focus|focus-within|focus-visible|peer-focus-visible):(?:border|ring|outline)-accent-primary(?![a-zA-Z0-9-])/g;
const NON_PRIMARY_FILL = /(?<![a-zA-Z0-9-])(?:hover:)?bg-accent-(secondary|success|warning|error|info)(?![a-zA-Z0-9-])/;
const INVERSE = /(?<![a-zA-Z0-9-])text-inverse(?![a-zA-Z0-9-/])/;

const verbose = process.argv.includes("--verbose");
const github = process.argv.includes("--github");
/** @type {Array<{ file: string, line: number, message: string }>} */
const findings = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full).split(sep).join("/");
    if (SKIP_DIRS.some((skip) => rel === skip || rel.startsWith(`${skip}/`))) continue;
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    const ext = entry.slice(entry.lastIndexOf("."));
    if (!EXTENSIONS.has(ext) || /\.test\.[jt]sx?$/.test(entry)) continue;
    checkFile(full, rel, ext);
  }
}

function allowed(rel, rule) {
  return ALLOWLIST[rel]?.rules.includes(rule) ?? false;
}

function checkFile(full, rel, ext) {
  const lines = readFileSync(full, "utf8").split("\n");
  lines.forEach((line, index) => {
    const report = (message) => findings.push({ file: rel, line: index + 1, message });
    if (!allowed(rel, "palette")) {
      for (const match of line.matchAll(PALETTE)) {
        report(`Tailwind palette class "${match[0]}" bypasses the theme (use an accent/surface/semantic token, see DESIGN.md)`);
      }
    }
    if (ext !== ".css" && !allowed(rel, "hex") && !COMMENT_LINE.test(line)) {
      for (const match of line.matchAll(HEX)) {
        report(`hex color "${match[0]}" bypasses the theme (read currentTheme.colors or a CSS variable)`);
      }
    }
    if (ext !== ".css" && !allowed(rel, "rgb") && RGB.test(line) && !NEUTRAL_RGB.test(line)) {
      report(`rgb()/hsl() literal bypasses the theme (use color-mix over a theme variable)`);
    }
    if (!allowed(rel, "white")) {
      if (WHITE_ON_ACCENT.test(line) && ACCENT_BG.test(line)) {
        report(`"text-white" over an accent background is unreadable on light-accent themes (use "text-inverse")`);
      }
      if (HOVER_WHITE.test(line)) {
        report(`"hover:text-white" assumes a dark theme (use "hover:text-primary")`);
      }
    }
    if (!allowed(rel, "palette")) {
      for (const match of line.matchAll(ACCENT_AS_TEXT)) {
        report(`"${match[0]}" paints text with the accent fill; use "text-accent" (theme text.accent)`);
      }
      for (const match of line.matchAll(ACCENT_FOCUS)) {
        report(`"${match[0]}" colors a focus state with the accent; use the "focus" token (border-focus, ring-focus, outline-focus)`);
      }
      const fill = NON_PRIMARY_FILL.exec(line);
      if (fill && INVERSE.test(line)) {
        report(`"text-inverse" is only guaranteed on accent.primary; over bg-accent-${fill[1]} use "text-on-accent-${fill[1]}"`);
      }
    }
  });
}

walk(SRC);

if (findings.length > 0) {
  console.error(`Theme token check: ${findings.length} problem(s)\n`);
  for (const { file, line, message } of findings) {
    console.error(`  ${file}:${line}: ${message}`);
    // Annotation values must escape %, CR and LF (GitHub workflow command syntax).
    if (github) console.log(`::error file=${file},line=${line},title=Theme token::${message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
  }
  console.error("\nSee DESIGN.md for the token to use in each case.");
  process.exit(1);
}
if (verbose) {
  console.log(`Theme token check: scanned src/, allowlist has ${Object.keys(ALLOWLIST).length} file(s).`);
}
console.log("Theme token check: OK");
