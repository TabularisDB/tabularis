import { describe, expect, it } from "vitest";

import {
  collectBoundaryUsage,
  validateBoundaryUsage,
} from "../scripts/check-web-ui-frontend-boundaries.mjs";

const emptyAllowlist = {
  schemaVersion: 1,
  adapterFiles: [],
  legacyTauriImports: {},
  legacyDirectInvokes: {},
};

describe("web UI frontend boundaries", () => {
  it("finds Tauri imports and direct invoke calls through aliases", () => {
    const usage = collectBoundaryUsage([
      {
        path: "src/example.ts",
        source: `
          import { invoke as callTauri } from "@tauri-apps/api/core";
          import * as tauriCore from "@tauri-apps/api/core";
          import { open } from "@tauri-apps/plugin-dialog";
          callTauri("first_command");
          tauriCore.invoke("second_command");
        `,
      },
    ]);

    expect(usage).toEqual({
      tauriImports: [{ file: "src/example.ts", count: 3 }],
      directInvokes: [{ file: "src/example.ts", count: 2 }],
    });
  });

  it("allows adapters and exact temporary legacy entries", () => {
    const errors = validateBoundaryUsage(
      {
        tauriImports: [
          { file: "src/api/transports/tauriTransport.ts", count: 2 },
          { file: "src/legacy.tsx", count: 1 },
        ],
        directInvokes: [
          { file: "src/api/transports/tauriTransport.ts", count: 2 },
          { file: "src/legacy.tsx", count: 3 },
        ],
      },
      {
        ...emptyAllowlist,
        adapterFiles: ["src/api/transports/tauriTransport.ts"],
        legacyTauriImports: { "src/legacy.tsx": 1 },
        legacyDirectInvokes: { "src/legacy.tsx": 3 },
      },
    );

    expect(errors).toEqual([]);
  });

  it("rejects new coupling and stale temporary entries", () => {
    const errors = validateBoundaryUsage(
      {
        tauriImports: [
          { file: "src/legacy.tsx", count: 2 },
          { file: "src/new-component.tsx", count: 1 },
        ],
        directInvokes: [{ file: "src/legacy.tsx", count: 2 }],
      },
      {
        ...emptyAllowlist,
        legacyTauriImports: {
          "src/legacy.tsx": 1,
          "src/removed.tsx": 1,
        },
        legacyDirectInvokes: { "src/legacy.tsx": 1 },
      },
    );

    expect(errors).toEqual([
      "src/legacy.tsx has 2 Tauri imports but its temporary allowance is 1",
      "src/new-component.tsx has 1 Tauri import and is not an adapter or temporary exception",
      "src/removed.tsx no longer has Tauri imports; remove its temporary exception",
      "src/legacy.tsx has 2 direct invoke calls but its temporary allowance is 1",
    ]);
  });
});
