import { describe, expect, it } from "vitest";
import { formatCount, stripTrailingSlash } from "../../src/utils/pluginPresentation";

describe("pluginPresentation", () => {
  it.each([
    ["", ""],
    ["https://example.com", "https://example.com"],
    ["https://example.com///", "https://example.com"],
    ["https://example.com/path/", "https://example.com/path"],
  ])("normalizes trailing slashes in %s", (url, expected) => {
    expect(stripTrailingSlash(url)).toBe(expected);
  });

  it.each([
    [0, "0"], [999, "999"], [1000, "1.0k"], [12500, "12.5k"],
    [1000000, "1.0M"], [2500000, "2.5M"],
  ])("formats download count %i", (count, expected) => {
    expect(formatCount(count)).toBe(expected);
  });
});
