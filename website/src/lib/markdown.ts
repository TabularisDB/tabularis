import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import { getAllPlugins, getLatestRelease } from "./plugins";

marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);

function renderPluginCard(id: string): string {
  const plugin = getAllPlugins().find((p) => p.id === id);
  if (!plugin) return `<!-- plugin not found: ${id} -->`;

  const latestRelease = getLatestRelease(plugin);
  const authorName = plugin.author.includes("<")
    ? plugin.author.split("<")[0].trim()
    : plugin.author;
  const authorUrl = plugin.author.match(/<(.+)>/)?.[1];
  const authorHtml = authorUrl
    ? `<a href="${authorUrl}" target="_blank" rel="noopener noreferrer">${authorName}</a>`
    : authorName;
  const versionHint = latestRelease?.min_tabularis_version
    ? ` &middot; <span class="plugin-platforms">Requires Tabularis v${latestRelease.min_tabularis_version}</span>`
    : "";

  return `<div class="plugin-list">
  <div class="plugin-entry">
    <div class="plugin-entry-info">
      <div class="plugin-entry-header">
        <a href="${plugin.homepage}" target="_blank" rel="noopener noreferrer" class="plugin-name">${plugin.name}</a>
        <span class="plugin-badge">v${plugin.latest_version}</span>
      </div>
      <p class="plugin-desc">${plugin.description}</p>
      <div class="plugin-meta">by ${authorHtml}${versionHint}</div>
    </div>
    <a href="${plugin.homepage}" target="_blank" rel="noopener noreferrer" class="plugin-name">Repo &rarr;</a>
  </div>
</div>`;
}

marked.use({
  extensions: [
    {
      name: "pluginCard",
      level: "block",
      start(src: string) {
        return src.indexOf(":::plugin");
      },
      tokenizer(src: string) {
        const match = src.match(/^:::plugin\s+(\S+):::\s*(?:\n|$)/);
        if (match) {
          return { type: "pluginCard", raw: match[0], pluginId: match[1] };
        }
      },
      renderer(token) {
        return renderPluginCard(token["pluginId"] as string);
      },
    },
    {
      name: "newsletter",
      level: "block",
      start(src: string) {
        return src.indexOf(":::newsletter");
      },
      tokenizer(src: string) {
        const match = src.match(/^:::newsletter:::\s*(?:\n|$)/);
        if (match) {
          return { type: "newsletter", raw: match[0] };
        }
      },
      renderer() {
        return `<div data-newsletter></div>`;
      },
    },
  ],
});

export { marked };
