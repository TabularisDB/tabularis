import { describe, it, expect } from "vitest";
import { toErrorMessage, splitErrorDetails } from "../../src/utils/errors";

describe("toErrorMessage", () => {
  it("returns strings unchanged", () => {
    expect(toErrorMessage("boom")).toBe("boom");
  });

  it("extracts the message from Error instances", () => {
    expect(toErrorMessage(new Error("kaboom"))).toBe("kaboom");
  });

  it("reads the message field of plain objects", () => {
    expect(toErrorMessage({ message: "from object" })).toBe("from object");
  });

  it("falls back to String() for arbitrary values", () => {
    expect(toErrorMessage(42)).toBe("42");
    expect(toErrorMessage(null)).toBe("null");
  });
});

describe("splitErrorDetails", () => {
  it("splits summary and technical detail on the Error marker", () => {
    const msg =
      "Failed to connect to Dev.\n\nError: ssh: connect to host x port 22: Connection refused";
    expect(splitErrorDetails(msg)).toEqual({
      summary: "Failed to connect to Dev.",
      details: "ssh: connect to host x port 22: Connection refused",
    });
  });

  it("treats the whole message as summary when no marker is present", () => {
    expect(splitErrorDetails("Something went wrong")).toEqual({
      summary: "Something went wrong",
      details: null,
    });
  });

  it("returns null details when the detail part is blank", () => {
    expect(splitErrorDetails("Header\n\nError:   ")).toEqual({
      summary: "Header",
      details: null,
    });
  });

  it("preserves multi-line technical detail", () => {
    const detail = "line 1\nline 2\nline 3";
    const { summary, details } = splitErrorDetails(`Headline\n\nError: ${detail}`);
    expect(summary).toBe("Headline");
    expect(details).toBe(detail);
  });
});
