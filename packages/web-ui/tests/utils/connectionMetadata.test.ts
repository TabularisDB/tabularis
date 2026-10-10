import { describe, expect, it, vi } from "vitest";
import { loadOptionalMetadata } from "../../src/utils/connectionMetadata";

describe("loadOptionalMetadata", () => {
  it("skips disabled metadata without calling the plugin", async () => {
    const load = vi.fn().mockRejectedValue(new Error("unsupported"));
    expect(await loadOptionalMetadata(false, load, [])).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it.each([true, undefined])("preserves loading when support is %s", async supported => {
    const load = vi.fn().mockResolvedValue(["public"]);
    expect(await loadOptionalMetadata(supported, load, [])).toEqual(["public"]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("surfaces errors for enabled capabilities", async () => {
    await expect(loadOptionalMetadata(true, () => Promise.reject(new Error("permission denied")), []))
      .rejects.toThrow("permission denied");
  });
});
