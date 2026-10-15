/**
 * Helpers to make plugin README HTML self-contained: registry READMEs are
 * authored against their repository layout, so relative image/link paths
 * only work when resolved against the plugin's repo URL.
 */

const GITHUB_REPO_RE =
  /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i;

/** Absolute URLs, protocol-relative URLs, other schemes, and pure fragments
 * must never be rewritten. */
const NON_RELATIVE_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/**
 * Resolve a relative README asset path against the plugin's repository URL.
 * GitHub repos get proper raw-content URLs for images (`raw.githubusercontent
 * .com/{owner}/{repo}/HEAD/…`) and blob pages for links; other hosts get a
 * best-effort URL join. Returns `null` when the URL should be left alone
 * (already absolute, a fragment, or no repo URL to resolve against).
 */
export function resolveReadmeAssetUrl(
  repoUrl: string | null | undefined,
  url: string,
  kind: "image" | "link",
): string | null {
  if (!url || !repoUrl || NON_RELATIVE_RE.test(url)) return null;
  // Both `./docs/x.png` and `/docs/x.png` mean "from the repo root" in
  // practice — README renderers treat the repo as the site root.
  const path = url.replace(/^\.\//, "").replace(/^\/+/, "");
  const github = repoUrl.match(GITHUB_REPO_RE);
  if (github) {
    const [, owner, repo] = github;
    return kind === "image"
      ? `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`
      : `https://github.com/${owner}/${repo}/blob/HEAD/${path}`;
  }
  try {
    return new URL(path, `${repoUrl.replace(/\/+$/, "")}/`).toString();
  } catch {
    return null;
  }
}

/**
 * Rewrite relative `img src` / `a href` values in sanitized README HTML to
 * absolute URLs based on the plugin's repository. Call AFTER sanitization —
 * only the two URL attributes are touched, so the markup stays safe.
 */
export function rewriteReadmeUrls(
  html: string,
  repoUrl: string | null | undefined,
): string {
  if (!repoUrl) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("img[src]").forEach((img) => {
    const resolved = resolveReadmeAssetUrl(
      repoUrl,
      img.getAttribute("src") ?? "",
      "image",
    );
    if (resolved) img.setAttribute("src", resolved);
    // Responsive candidates would need the same per-URL resolution; READMEs
    // don't author them, so drop rather than let relative ones 404.
    img.removeAttribute("srcset");
  });
  template.content.querySelectorAll("a[href]").forEach((anchor) => {
    const resolved = resolveReadmeAssetUrl(
      repoUrl,
      anchor.getAttribute("href") ?? "",
      "link",
    );
    if (resolved) anchor.setAttribute("href", resolved);
  });
  return template.innerHTML;
}
