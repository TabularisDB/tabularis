import { describe, it, expect } from "vitest";
import {
  buildExportFileName,
  sanitizeFileNamePart,
} from "../../src/utils/exportFileName";

const date = new Date(2026, 9, 12, 14, 3, 27);

describe("buildExportFileName", () => {
  it("uses the table name and the local date for table tabs", () => {
    expect(
      buildExportFileName({ tableName: "orders", extension: "csv", date }),
    ).toBe("orders_2026-10-12.csv");
  });

  it("uses a readable date and time when there is no table", () => {
    expect(buildExportFileName({ extension: "json", date })).toBe(
      "result_2026-10-12_1403.json",
    );
    expect(
      buildExportFileName({ tableName: null, extension: "md", date }),
    ).toBe("result_2026-10-12_1403.md");
  });

  it("pads single digit months, days, hours and minutes", () => {
    const early = new Date(2026, 0, 5, 7, 9);
    expect(buildExportFileName({ extension: "csv", date: early })).toBe(
      "result_2026-01-05_0709.csv",
    );
  });

  it("falls back to the generic name when the table name has nothing usable", () => {
    expect(
      buildExportFileName({ tableName: "///", extension: "csv", date }),
    ).toBe("result_2026-10-12_1403.csv");
    expect(
      buildExportFileName({ tableName: "  ", extension: "csv", date }),
    ).toBe("result_2026-10-12_1403.csv");
  });
});

describe("sanitizeFileNamePart", () => {
  it("replaces characters that are invalid in file names", () => {
    expect(sanitizeFileNamePart('a/b\\c:d*e?f"g<h>i|j')).toBe(
      "a_b_c_d_e_f_g_h_i_j",
    );
  });

  it("replaces control characters", () => {
    expect(sanitizeFileNamePart("line\nbreak\ttab")).toBe("line_break_tab");
  });

  it("keeps dots and unicode inside the name", () => {
    expect(sanitizeFileNamePart("public.ordini_città")).toBe(
      "public.ordini_città",
    );
  });

  it("drops trailing dots and spaces, which Windows does not allow", () => {
    expect(sanitizeFileNamePart("orders. . ")).toBe("orders");
  });

  it("avoids Windows reserved device names", () => {
    expect(sanitizeFileNamePart("con")).toBe("con_");
    expect(sanitizeFileNamePart("LPT1")).toBe("LPT1_");
    expect(sanitizeFileNamePart("console")).toBe("console");
  });

  it("caps the length", () => {
    expect(sanitizeFileNamePart("x".repeat(300))).toHaveLength(100);
  });
});
