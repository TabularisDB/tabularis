import DOMPurify from "dompurify";
import { rewriteReadmeUrls } from "./pluginReadme";

/** Metadata links are explicit browser actions, never automatic asset fetches. */
export function safeThemeExternalUrl(value: string | null | undefined): string | undefined {
  if (!value || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "");
    if (/\/api\/plugins\/[^/]+\/(?:latest|releases\/[^/]+)$/.test(path)) return undefined;
    return url.href;
  } catch { return undefined; }
}

/** Parse in inert template contents and remove fetching/interactive media before
 * inserting anything into the live document. Driver README behavior is separate.
 */
export function themeReadmeHtml(html: string, repoUrl: string | null): string {
  if (new TextEncoder().encode(html).byteLength > 256 * 1024) throw new Error("Theme README exceeds the preview byte limit");
  const template = document.createElement("template");
  template.innerHTML = html;
  const walker = template.content.ownerDocument.createTreeWalker(template.content);
  let nodes = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (++nodes > 32768) throw new Error("Theme README exceeds the preview node limit");
    let depth = 0;
    for (let parent = node.parentNode; parent; parent = parent.parentNode) {
      if (++depth > 128) throw new Error("Theme README exceeds the preview depth limit");
    }
  }
  // IN_PLACE expects an Element, not a DocumentFragment. The wrapper belongs
  // to the template's inert document and is never attached to the live page.
  const wrapper = template.content.ownerDocument.createElement("div");
  while (template.content.firstChild) wrapper.appendChild(template.content.firstChild);
  template.content.append(wrapper);
  DOMPurify.sanitize(wrapper, {
    IN_PLACE: true, USE_PROFILES: { html: true }, SANITIZE_NAMED_PROPS: true,
    FORBID_TAGS: ["img", "picture", "video", "audio", "source", "iframe", "object", "embed", "link", "style", "meta", "base", "svg", "math", "form", "input", "button", "select", "textarea", "label"],
    FORBID_ATTR: ["style", "src", "srcset", "poster", "background", "ping", "rel", "for", "form", "formaction", "autofocus", "tabindex", "contenteditable"],
  });
  template.innerHTML = rewriteReadmeUrls(wrapper.innerHTML, repoUrl);
  for (const anchor of template.content.querySelectorAll("a")) {
    const url = safeThemeExternalUrl(anchor.getAttribute("href"));
    if (url) anchor.setAttribute("href", url); else anchor.removeAttribute("href");
    anchor.removeAttribute("target");
  }
  return template.innerHTML;
}
