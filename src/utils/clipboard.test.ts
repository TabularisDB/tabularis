import { describe, it, expect } from "vitest";
import { rowsToMarkdown } from "./clipboard";

describe("rowsToMarkdown", () => {
  it("formats rows as a GFM table with header and separator", () => {
    const result = rowsToMarkdown(
      [
        [1, "Alice"],
        [2, "Bob"],
      ],
      ["id", "name"],
    );
    expect(result).toBe(
      "| id | name |\n| --- | --- |\n| 1 | Alice |\n| 2 | Bob |",
    );
  });

  it("renders null/undefined cells with the null label", () => {
    const result = rowsToMarkdown([[null, undefined]], ["a", "b"]);
    expect(result).toBe("| a | b |\n| --- | --- |\n| null | null |");
  });

  it("escapes pipes and converts newlines to <br>", () => {
    const result = rowsToMarkdown([["a|b", "line1\nline2"]], ["col1", "col2"]);
    expect(result).toBe(
      "| col1 | col2 |\n| --- | --- |\n| a\\|b | line1<br>line2 |",
    );
  });

  it("omits header and separator when includeHeaders is false", () => {
    const result = rowsToMarkdown([[1, "Alice"]], ["id", "name"], "null", false);
    expect(result).toBe("| 1 | Alice |");
  });

  it("returns only header and separator when there are no rows", () => {
    const result = rowsToMarkdown([], ["x"]);
    expect(result).toBe("| x |\n| --- |");
  });
});
