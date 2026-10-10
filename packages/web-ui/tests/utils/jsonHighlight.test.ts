import { describe, it, expect } from "vitest";
import { tokenizeJsonDisplay } from "../../src/utils/jsonHighlight";

describe("tokenizeJsonDisplay", () => {
  it("tokenizes a flat object", () => {
    const tokens = tokenizeJsonDisplay('{"a":1}');
    expect(tokens).toEqual([
      { type: "punct", text: "{" },
      { type: "key", text: '"a"' },
      { type: "punct", text: ":" },
      { type: "number", text: "1" },
      { type: "punct", text: "}" },
    ]);
  });

  it("distinguishes keys from values when followed by colon", () => {
    const tokens = tokenizeJsonDisplay('{"name":"alice"}');
    expect(tokens.find((t) => t.text === '"name"')).toEqual({
      type: "key",
      text: '"name"',
    });
    expect(tokens.find((t) => t.text === '"alice"')).toEqual({
      type: "string",
      text: '"alice"',
    });
  });

  it("emits whitespace tokens", () => {
    const tokens = tokenizeJsonDisplay('{ "a" : 1 }');
    const whitespace = tokens.filter((t) => t.type === "whitespace");
    expect(whitespace.length).toBeGreaterThan(0);
  });

  it("tokenizes booleans and null", () => {
    const tokens = tokenizeJsonDisplay("[true,false,null]");
    const types = tokens.map((t) => t.type);
    expect(types).toContain("boolean");
    expect(types).toContain("null");
    expect(tokens.filter((t) => t.text === "true")[0].type).toBe("boolean");
    expect(tokens.filter((t) => t.text === "null")[0].type).toBe("null");
  });

  it("tokenizes negative and decimal numbers", () => {
    const tokens = tokenizeJsonDisplay("[-1.5,2e10,3]");
    const numbers = tokens
      .filter((t) => t.type === "number")
      .map((t) => t.text);
    expect(numbers).toEqual(["-1.5", "2e10", "3"]);
  });

  it("tolerates truncated input without throwing", () => {
    expect(() => tokenizeJsonDisplay('{"long":"abc...')).not.toThrow();
    expect(() => tokenizeJsonDisplay("[1,2,3")).not.toThrow();
    expect(() => tokenizeJsonDisplay("{")).not.toThrow();
  });

  it("returns empty array for empty input", () => {
    expect(tokenizeJsonDisplay("")).toEqual([]);
  });

  it("handles escaped quotes inside strings", () => {
    const tokens = tokenizeJsonDisplay('{"a":"b\\"c"}');
    const strings = tokens.filter((t) => t.type === "string");
    expect(strings.length).toBe(1);
    expect(strings[0].text).toBe('"b\\"c"');
  });
});
