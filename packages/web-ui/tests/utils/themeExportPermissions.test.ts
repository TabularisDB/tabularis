import { describe, expect, it } from "vitest";
import capability from "../../../../src-tauri/capabilities/theme-package-export.json";

describe("theme ZIP export capability", () => {
  it("adds only binary file writing in the main window, without broader filesystem scopes", () => {
    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).toEqual(["fs:allow-write-file"]);
    expect(capability).not.toHaveProperty("remote");
  });
});
