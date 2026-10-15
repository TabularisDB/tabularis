import { describe, expect, it } from "vitest";
import { safeThemeExternalUrl, themeReadmeHtml } from "../../src/utils/themeReadme";

describe("read-only theme README/media handling", () => {
  it("removes active/fetching media and scripts before inserting readable HTML", () => {
    const html = themeReadmeHtml('<h1>Theme</h1><p style="background:url(https://example.invalid/track)">Text</p><img src="https://registry.invalid/api/plugins/theme/latest?redirect=1"><iframe src="https://example.invalid"></iframe><script>alert(1)</script><form><input type="image" src="https://example.invalid/image"></form><a ping="https://example.invalid/ping" href="https://example.invalid/guide">Guide</a>', null);
    const template = document.createElement("template"); template.innerHTML = html;
    expect(template.content.querySelector("h1")?.textContent).toBe("Theme");
    expect(template.content.querySelector("img,iframe,script,form,input,[src],[style],[ping]")).toBeNull();
    expect(template.content.querySelector("a")?.getAttribute("href")).toBe("https://example.invalid/guide");
  });
  it("rejects executable, credential-bearing and tracked endpoint links including encoded paths", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,hello", "https://user:pass@example.invalid/image.png", "https://registry.invalid/api/plugins/theme/latest", "https://registry.invalid/api/plugins/theme/%6catest?redirect=1", "https://registry.invalid/api/plugins/theme/releases/1.0.0"]) expect(safeThemeExternalUrl(value), value).toBeUndefined();
    expect(safeThemeExternalUrl("https://example.invalid/theme.png")).toBe("https://example.invalid/theme.png");
    expect(themeReadmeHtml('<a href="https://registry.invalid/api/plugins/theme/latest">Unsafe counter link</a>', null)).not.toContain("href=");
  });
  it("bounds README node count and nesting before inserting DOM", () => {
    expect(() => themeReadmeHtml("<br>".repeat(32769), null)).toThrow("node limit");
    expect(() => themeReadmeHtml("<div>".repeat(130) + "x" + "</div>".repeat(130), null)).toThrow("depth limit");
  });
  it("bounds UTF-8 input before DOM parsing", () => {
    expect(() => themeReadmeHtml("a".repeat(256 * 1024 + 1), null)).toThrow("limit");
    expect(() => themeReadmeHtml("😀".repeat(65537), null)).toThrow("limit");
  });
});
