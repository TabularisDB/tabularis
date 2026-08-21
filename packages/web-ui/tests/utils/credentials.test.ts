import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { fetchConnectionWithCredentials } from "../../src/utils/credentials";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("credentials", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  describe("fetchConnectionWithCredentials", () => {
    it("invoca find_connection_by_id con l'id fornito", async () => {
      const mockConn = {
        id: "abc",
        name: "Test",
        params: { driver: "mysql", password: "secret", database: "mydb" },
      };
      vi.mocked(invoke).mockResolvedValueOnce(mockConn);

      const result = await fetchConnectionWithCredentials("abc");

      expect(invoke).toHaveBeenCalledWith("get_connection_by_id", { id: "abc" });
      expect(result).toEqual(mockConn);
    });

    it("propaga gli errori del backend", async () => {
      vi.mocked(invoke).mockRejectedValueOnce("Connection not found");

      await expect(fetchConnectionWithCredentials("unknown")).rejects.toBe(
        "Connection not found",
      );
    });
  });
});
