import { describe, expect, it } from "vitest";
import { parseChangelog } from "@/utils/changelog";

describe("parseChangelog", () => {
  it("parses minor releases written as level-one headings", () => {
    const entries = parseChangelog(
      `# [0.10.0](https://example.com/compare/v0.9.21...v0.10.0) (2026-04-27)

### Features

* **ai:** add AI audit log ([abc1234](https://example.com/commit/abc1234))

## [0.9.21](https://example.com/compare/v0.9.20...v0.9.21) (2026-04-22)

### Bug Fixes

* **ci:** correct release packaging ([def5678](https://example.com/commit/def5678))
`,
      {},
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      version: "0.10.0",
      date: "2026-04-27",
      features: ["Add AI audit log"],
    });
    expect(entries[1]).toMatchObject({
      version: "0.9.21",
      date: "2026-04-22",
      bugFixes: ["Correct release packaging"],
    });
  });

  it("keeps inline markdown (links, code, bold) in the parsed lines", () => {
    const entries = parseChangelog(
      `# [0.10.0](https://example.com/compare/v0.9.21...v0.10.0) (2026-04-27)

### Features

* **editor:** support \`EXPLAIN\` and link to [the docs](https://example.com/docs) ([abc1234](https://example.com/commit/abc1234))
`,
      {},
    );

    expect(entries[0].features).toEqual([
      "Support `EXPLAIN` and link to [the docs](https://example.com/docs)",
    ]);
  });
});
