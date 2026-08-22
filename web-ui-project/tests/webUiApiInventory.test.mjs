import { describe, expect, it } from "vitest";

import {
  buildInventory,
  extractFrontendInvocations,
  extractTauriHandlers,
  validateInventory,
} from "../scripts/generate-web-ui-api-inventory.mjs";

describe("web UI API inventory", () => {
  it("extracts literal and dynamic calls through imported invoke aliases", () => {
    const result = extractFrontendInvocations([
      {
        path: "src/example.ts",
        source: `
          import { invoke as callTauri } from "@tauri-apps/api/core";
          const commandName = shouldSave ? "save_prompt" : "reset_prompt";
          callTauri<Result>("get_tables", { connectionId });
          callTauri(commandName, payload);
        `,
      },
    ]);

    expect(result.literalInvocations).toEqual([
      { command: "get_tables", file: "src/example.ts", line: 4 },
    ]);
    expect(result.dynamicInvocations).toEqual([
      {
        expression: "commandName",
        file: "src/example.ts",
        line: 5,
        context: null,
        possibleCommands: ["reset_prompt", "save_prompt"],
      },
    ]);
  });

  it("extracts registered command names from the Tauri handler macro", () => {
    const handlers = extractTauriHandlers(`
      .invoke_handler(tauri::generate_handler![
        commands::get_tables,
        // Keep module-qualified registrations readable.
        plugins::commands::install_plugin,
        is_debug_mode,
      ])
    `);

    expect(handlers).toEqual(["get_tables", "install_plugin", "is_debug_mode"]);
  });

  it("rejects new, unclassified, and unregistered direct invocations", () => {
    const inventory = buildInventory({
      frontend: {
        literalInvocations: [
          { command: "get_tables", file: "src/example.ts", line: 2 },
          { command: "new_command", file: "src/example.ts", line: 3 },
        ],
        dynamicInvocations: [],
      },
      handlers: ["get_tables"],
      previous: {
        commands: [
          {
            name: "get_tables",
            featureGroup: "metadata",
            eventUse: "none",
            filesystemUse: "none",
            authorizationLevel: "database",
          },
        ],
      },
    });
    const errors = validateInventory(inventory);

    expect(errors).toEqual([
      "Command new_command is missing featureGroup classification",
      "Command new_command is missing eventUse classification",
      "Command new_command is missing filesystemUse classification",
      "Command new_command is missing authorizationLevel classification",
      "Frontend command new_command is not registered by the Tauri handler",
    ]);
  });
});
