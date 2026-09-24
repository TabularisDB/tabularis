import { describe, it, expect } from "vitest";
import {
  resolveReadmeAssetUrl,
  rewriteReadmeUrls,
} from "../../src/utils/pluginReadme";

const GH = "https://github.com/TabularisDB/tabularis-db2-plugin";

describe("pluginReadme", () => {
  describe("resolveReadmeAssetUrl", () => {
    it("resolves relative images to raw.githubusercontent.com for GitHub repos", () => {
      expect(resolveReadmeAssetUrl(GH, "docs/screenshot.png", "image")).toBe(
        "https://raw.githubusercontent.com/TabularisDB/tabularis-db2-plugin/HEAD/docs/screenshot.png",
      );
    });

    it("resolves relative links to the GitHub blob page", () => {
      expect(resolveReadmeAssetUrl(GH, "docs/setup.md", "link")).toBe(
        "https://github.com/TabularisDB/tabularis-db2-plugin/blob/HEAD/docs/setup.md",
      );
    });

    it("treats ./ and / prefixes as repo-root relative", () => {
      expect(resolveReadmeAssetUrl(GH, "./logo.png", "image")).toBe(
        "https://raw.githubusercontent.com/TabularisDB/tabularis-db2-plugin/HEAD/logo.png",
      );
      expect(resolveReadmeAssetUrl(GH, "/logo.png", "image")).toBe(
        "https://raw.githubusercontent.com/TabularisDB/tabularis-db2-plugin/HEAD/logo.png",
      );
    });

    it("handles .git suffixes and trailing slashes on the repo URL", () => {
      expect(
        resolveReadmeAssetUrl(`${GH}.git`, "logo.png", "image"),
      ).toContain("raw.githubusercontent.com/TabularisDB/tabularis-db2-plugin/HEAD");
      expect(resolveReadmeAssetUrl(`${GH}/`, "logo.png", "image")).toContain(
        "raw.githubusercontent.com/TabularisDB/tabularis-db2-plugin/HEAD",
      );
    });

    it("joins against the repo URL for non-GitHub hosts", () => {
      expect(
        resolveReadmeAssetUrl(
          "https://codeberg.org/NewtTheWolf/firestore-tabularis",
          "docs/img.png",
          "image",
        ),
      ).toBe("https://codeberg.org/NewtTheWolf/firestore-tabularis/docs/img.png");
    });

    it("leaves absolute URLs, fragments, and other schemes alone", () => {
      expect(resolveReadmeAssetUrl(GH, "https://x.dev/a.png", "image")).toBeNull();
      expect(resolveReadmeAssetUrl(GH, "//cdn.x.dev/a.png", "image")).toBeNull();
      expect(resolveReadmeAssetUrl(GH, "#usage", "link")).toBeNull();
      expect(resolveReadmeAssetUrl(GH, "mailto:a@b.c", "link")).toBeNull();
      expect(resolveReadmeAssetUrl(GH, "data:image/png;base64,x", "image")).toBeNull();
    });

    it("returns null without a repo URL or URL", () => {
      expect(resolveReadmeAssetUrl(null, "a.png", "image")).toBeNull();
      expect(resolveReadmeAssetUrl(GH, "", "image")).toBeNull();
    });
  });

  describe("rewriteReadmeUrls", () => {
    it("rewrites relative img src and a href, leaving absolute ones alone", () => {
      const html =
        '<p><img src="docs/a.png"><a href="./b.md">b</a>' +
        '<img src="https://x.dev/c.png"><a href="#anchor">c</a></p>';
      const out = rewriteReadmeUrls(html, GH);
      expect(out).toContain(
        'src="https://raw.githubusercontent.com/TabularisDB/tabularis-db2-plugin/HEAD/docs/a.png"',
      );
      expect(out).toContain(
        'href="https://github.com/TabularisDB/tabularis-db2-plugin/blob/HEAD/b.md"',
      );
      expect(out).toContain('src="https://x.dev/c.png"');
      expect(out).toContain('href="#anchor"');
    });

    it("returns the HTML untouched without a repo URL", () => {
      const html = '<img src="docs/a.png">';
      expect(rewriteReadmeUrls(html, null)).toBe(html);
    });
  });
});
