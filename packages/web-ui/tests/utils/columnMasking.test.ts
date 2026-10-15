import {
  DEFAULT_MASKING_PATTERNS,
  isColumnMasked,
  isSensitiveColumnName,
  normalizeMaskingPatterns,
} from "../../src/utils/columnMasking";

describe("normalizeMaskingPatterns", () => {
  it("trims, lowercases and drops empty entries", () => {
    expect(normalizeMaskingPatterns([" Password ", "EMAIL", "", "  "])).toEqual(
      ["password", "email"],
    );
  });
});

describe("isSensitiveColumnName", () => {
  it("matches case-insensitively as a substring", () => {
    expect(isSensitiveColumnName("User_Email", ["email"])).toBe(true);
    expect(isSensitiveColumnName("email_count", ["email"])).toBe(true);
    expect(isSensitiveColumnName("name", ["email"])).toBe(false);
  });
});

describe("isColumnMasked", () => {
  const config = {
    enabled: true,
    patterns: DEFAULT_MASKING_PATTERNS,
    overrides: {
      "conn-1": {
        include: ["users.contact_info"],
        exclude: ["stats.email_count"],
      },
    },
  };

  it("masks pattern matches and leaves other columns alone", () => {
    expect(isColumnMasked("password", "users", "conn-1", config)).toBe(true);
    expect(isColumnMasked("name", "users", "conn-1", config)).toBe(false);
  });

  it("does nothing when disabled", () => {
    expect(
      isColumnMasked("password", "users", "conn-1", {
        ...config,
        enabled: false,
      }),
    ).toBe(false);
  });

  it("exclude wins over a pattern match", () => {
    expect(isColumnMasked("email_count", "stats", "conn-1", config)).toBe(
      false,
    );
  });

  it("include masks a column the patterns miss", () => {
    expect(isColumnMasked("contact_info", "users", "conn-1", config)).toBe(
      true,
    );
  });

  it("overrides are scoped per connection", () => {
    expect(isColumnMasked("contact_info", "users", "conn-2", config)).toBe(
      false,
    );
  });

  it("overrides require the table.column pair; ad-hoc results use patterns", () => {
    // No table name (console query): the include entry does not apply…
    expect(isColumnMasked("contact_info", null, "conn-1", config)).toBe(false);
    // …but a pattern match still masks.
    expect(isColumnMasked("email", null, "conn-1", config)).toBe(true);
  });
});
