import { describe, expect, it } from "vitest";
import {
  createPlatformCapabilityNegotiation,
  requirePlatformCapability,
  UnsupportedPlatformCapabilityError,
} from "../../src/platform/capabilities";

describe("platform capability negotiation", () => {
  it("makes unadvertised capabilities explicitly unsupported", () => {
    const negotiation = createPlatformCapabilityNegotiation("browser", {
      writeClipboard: { supported: true, adaptation: "adapted" },
    });

    expect(negotiation.capabilities.writeClipboard).toEqual({
      supported: true,
      adaptation: "adapted",
    });
    expect(negotiation.capabilities.chooseInputFile).toEqual({
      supported: false,
      adaptation: "unsupported",
      reason: "The active platform did not advertise this capability",
    });
  });

  it("throws a typed error when a capability is unsupported", () => {
    const negotiation = createPlatformCapabilityNegotiation("browser", {
      restartApplication: {
        supported: false,
        adaptation: "unsupported",
        reason: "Only an administrator can restart the server",
      },
    });

    expect(() =>
      requirePlatformCapability(negotiation, "restartApplication"),
    ).toThrowError(UnsupportedPlatformCapabilityError);

    try {
      requirePlatformCapability(negotiation, "restartApplication");
    } catch (error) {
      expect(error).toMatchObject({
        code: "PLATFORM_CAPABILITY_UNSUPPORTED",
        capability: "restartApplication",
        environment: "browser",
      });
      expect((error as Error).message).toContain(
        "Only an administrator can restart the server",
      );
    }
  });
});
