import { invoke } from "@tauri-apps/api/core";
import { expect, vi } from "vitest";
import { HttpTransport } from "../../src/api/transports/httpTransport";
import { TauriTransport } from "../../src/api/transports/tauriTransport";
import serializationFixture from "../fixtures/transportSerialization.json";
import {
  createLiveWebContractServer,
  defineTransportContractSuite,
} from "./contract/transportContract";

defineTransportContractSuite(
  "Tauri adapter mock",
  serializationFixture,
  async () => {
    vi.mocked(invoke).mockImplementation(async (command, request) => {
      if (command === "is_debug_mode") {
        expect(request).toBeUndefined();
        return true;
      }
      if (command === "get_connections_with_groups") {
        expect(request).toBeUndefined();
        return { groups: [], connections: [] };
      }
      if (command === "contract_serialization_fixture") {
        expect(request).toEqual({ fixture: "complex-query-result" });
        return serializationFixture;
      }
      if (command === "cancel_query") {
        expect(request).toEqual({ connectionId: "missing-connection" });
        throw new Error("No running query found");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    return { transport: new TauriTransport() };
  },
);

defineTransportContractSuite(
  "live web server",
  serializationFixture,
  async () => {
    const server = await createLiveWebContractServer(serializationFixture);
    return {
      transport: new HttpTransport({ baseUrl: server.baseUrl }),
      close: server.close,
    };
  },
);
