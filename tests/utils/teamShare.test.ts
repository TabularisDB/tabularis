import { describe, it, expect } from "vitest";
import {
  countShared,
  filterByShare,
  isTeamShared,
  masterPasswordError,
  needsUnlockPrompt,
  shouldOpenUnlockPrompt,
  syncChangeCount,
  TEAM_SHARE_SOURCE,
  teamSharePhase,
  vaultFileName,
  vaultFolder,
  type TeamShareStatus,
} from "../../src/utils/teamShare";

function status(overrides: Partial<TeamShareStatus> = {}): TeamShareStatus {
  return {
    configured: true,
    path: "/mnt/team/tabularis-team-vault.json",
    vaultExists: true,
    unlocked: false,
    revision: 3,
    updatedAt: "2026-09-15T10:00:00.000Z",
    updatedBy: "alice@box",
    sharedConnectionIds: [],
    lastSync: null,
    ...overrides,
  };
}

describe("teamShare", () => {
  describe("teamSharePhase", () => {
    it("reports disabled when nothing is configured", () => {
      expect(teamSharePhase(null)).toBe("disabled");
      expect(teamSharePhase(status({ configured: false }))).toBe("disabled");
    });

    it("reports unlocked once the master password was entered", () => {
      expect(teamSharePhase(status({ unlocked: true }))).toBe("unlocked");
    });

    it("reports locked while the vault is there but closed", () => {
      expect(teamSharePhase(status())).toBe("locked");
    });

    it("separates an offline share from a locked one", () => {
      expect(teamSharePhase(status({ vaultExists: false }))).toBe("unreachable");
    });

    it("prefers unlocked over a vault file that went missing mid-session", () => {
      expect(teamSharePhase(status({ unlocked: true, vaultExists: false }))).toBe(
        "unlocked",
      );
    });
  });

  describe("needsUnlockPrompt", () => {
    it("asks for the password only for a reachable, locked vault", () => {
      expect(needsUnlockPrompt(status())).toBe(true);
    });

    it("stays quiet when there is nothing to unlock", () => {
      expect(needsUnlockPrompt(null)).toBe(false);
      expect(needsUnlockPrompt(status({ configured: false }))).toBe(false);
      expect(needsUnlockPrompt(status({ unlocked: true }))).toBe(false);
    });

    it("does not ask for a password it could not check", () => {
      expect(needsUnlockPrompt(status({ vaultExists: false }))).toBe(false);
    });
  });

  describe("shouldOpenUnlockPrompt", () => {
    const locked = status();

    it("opens at startup and on a locked lookup until the user dismisses it", () => {
      expect(shouldOpenUnlockPrompt(locked, "startup", false)).toBe(true);
      expect(shouldOpenUnlockPrompt(locked, "locked", false)).toBe(true);
    });

    it("stays closed for background lookups once dismissed", () => {
      expect(shouldOpenUnlockPrompt(locked, "locked", true)).toBe(false);
    });

    it("reopens for an explicit request even after a dismissal", () => {
      expect(shouldOpenUnlockPrompt(locked, "explicit", true)).toBe(true);
    });

    it("never opens when there is nothing to unlock", () => {
      expect(shouldOpenUnlockPrompt(status({ unlocked: true }), "explicit", false)).toBe(
        false,
      );
      expect(shouldOpenUnlockPrompt(status({ vaultExists: false }), "explicit", false)).toBe(
        false,
      );
      expect(shouldOpenUnlockPrompt(null, "startup", false)).toBe(false);
    });
  });

  describe("isTeamShared", () => {
    it("recognises only the team share as the owner", () => {
      expect(isTeamShared({ managed_by: TEAM_SHARE_SOURCE })).toBe(true);
      expect(isTeamShared({ managed_by: "another-source" })).toBe(false);
      expect(isTeamShared({})).toBe(false);
      expect(isTeamShared({ managed_by: null })).toBe(false);
    });
  });

  describe("filterByShare", () => {
    const items = [
      { id: "a", managed_by: TEAM_SHARE_SOURCE },
      { id: "b" },
      { id: "c", managed_by: TEAM_SHARE_SOURCE },
      { id: "d", managed_by: "another-source" },
    ];

    it("passes everything through on 'all'", () => {
      expect(filterByShare(items, "all").map((i) => i.id)).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
    });

    it("keeps only the shared ones", () => {
      expect(filterByShare(items, "shared").map((i) => i.id)).toEqual(["a", "c"]);
    });

    it("treats a missing flag, or another source, as not shared", () => {
      expect(filterByShare(items, "local").map((i) => i.id)).toEqual(["b", "d"]);
    });

    it("preserves the incoming order", () => {
      expect(filterByShare(items, "shared").map((i) => i.id)).toEqual(["a", "c"]);
    });

    it("returns a copy on 'all' so callers cannot mutate the source", () => {
      const result = filterByShare(items, "all");
      expect(result).not.toBe(items);
    });

    it("handles an empty list", () => {
      expect(filterByShare([], "shared")).toEqual([]);
    });
  });

  describe("countShared", () => {
    it("counts only the flagged ones", () => {
      expect(
        countShared([
          { managed_by: TEAM_SHARE_SOURCE },
          {},
          { managed_by: "another-source" },
          { managed_by: TEAM_SHARE_SOURCE },
        ]),
      ).toBe(2);
    });

    it("is zero for an empty list", () => {
      expect(countShared([])).toBe(0);
    });
  });

  describe("syncChangeCount", () => {
    it("is zero when nothing was synced", () => {
      expect(syncChangeCount(null)).toBe(0);
      expect(
        syncChangeCount({
          pulled: 0,
          pushed: 0,
          conflicts: 0,
          removed: 0,
          revision: 4,
        }),
      ).toBe(0);
    });

    it("counts every kind of change, but not the revision", () => {
      expect(
        syncChangeCount({
          pulled: 2,
          pushed: 1,
          conflicts: 1,
          removed: 3,
          revision: 99,
        }),
      ).toBe(7);
    });
  });

  describe("path helpers", () => {
    it("reads a posix path", () => {
      expect(vaultFileName("/mnt/team/vault.json")).toBe("vault.json");
      expect(vaultFolder("/mnt/team/vault.json")).toBe("/mnt/team");
    });

    it("reads a windows UNC path", () => {
      const unc = "\\\\server\\share\\tabularis\\vault.json";
      expect(vaultFileName(unc)).toBe("vault.json");
      expect(vaultFolder(unc)).toBe("\\\\server\\share\\tabularis");
    });

    it("handles an empty path", () => {
      expect(vaultFileName(null)).toBe("");
      expect(vaultFolder(null)).toBe("");
      expect(vaultFileName("")).toBe("");
    });
  });

  describe("masterPasswordError", () => {
    it("accepts a password that matches its confirmation", () => {
      expect(masterPasswordError("hunter2", "hunter2")).toBeNull();
    });

    it("accepts any non-blank password when there is nothing to confirm", () => {
      expect(masterPasswordError("hunter2", null)).toBeNull();
    });

    it("rejects a blank password", () => {
      expect(masterPasswordError("", null)).toBe(
        "settings.teamShare.errorEmptyPassword",
      );
      expect(masterPasswordError("   ", "   ")).toBe(
        "settings.teamShare.errorEmptyPassword",
      );
    });

    it("rejects a typo in the confirmation", () => {
      expect(masterPasswordError("hunter2", "hunter3")).toBe(
        "settings.teamShare.errorPasswordMismatch",
      );
    });
  });
});
