import { readFileSync } from "node:fs";
import { parse } from "postcss";

const stylesheet = parse(
  readFileSync("src/index.css", "utf8"),
);

function getDeclaration(selector: string, property: string): string | undefined {
  let value: string | undefined;

  stylesheet.walkRules((rule) => {
    const selectors = rule.selector.split(",").map((item) => item.trim());
    if (!selectors.includes(selector)) return;

    rule.walkDecls(property, (declaration) => {
      value = declaration.value;
    });
  });

  return value;
}

describe("global scroll containment", () => {
  it("disables bounce and scroll chaining for standard scroll containers", () => {
    expect(getDeclaration(".overflow-auto", "overscroll-behavior")).toBe(
      "none",
    );
    expect(getDeclaration(".overflow-y-auto", "overscroll-behavior-y")).toBe(
      "none",
    );
    expect(getDeclaration(".overflow-x-auto", "overscroll-behavior-x")).toBe(
      "none",
    );
  });

  it("disables scrolling and overscroll on the document root", () => {
    for (const selector of ["html", "body", "#root"]) {
      expect(getDeclaration(selector, "overflow")).toBe("hidden");
      expect(getDeclaration(selector, "overscroll-behavior")).toBe("none");
    }
  });
});
