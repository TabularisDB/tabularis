import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rpc = readFileSync(new URL("../templates/rust-driver/src/rpc.rs", import.meta.url), "utf8");

describe("rust-driver rpc template", () => {
  // Most host fallbacks for optional methods match on the message
  // (is_method_not_found in src-tauri/src/plugins/driver.rs), a few on the code.
  it("answers unimplemented methods with -32601 and a message that triggers the host fallbacks", () => {
    const match = /pub fn not_implemented[\s\S]*?error_response\(\s*id,\s*(-?\d+),\s*&format!\("([^"]*)"/.exec(rpc);
    expect(match, "could not find the error_response call in not_implemented (rpc.rs)").not.toBeNull();
    expect(match?.[1]).toBe("-32601");
    expect(match?.[2]).toMatch(/method not found/i);
  });
});
