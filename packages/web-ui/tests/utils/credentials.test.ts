import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TypedCommandCaller } from "../../src/api/contract";
import { fetchConnectionWithCredentials } from "../../src/utils/credentials";

describe("credentials", () => {
  const call = vi.fn();
  const client = { call } as Pick<TypedCommandCaller, "call">;

  beforeEach(() => {
    call.mockReset();
  });

  describe("fetchConnectionWithCredentials", () => {
    it("calls get_connection_by_id with the supplied id", async () => {
      const mockConnection = {
        id: "abc",
        name: "Test",
        params: { driver: "mysql", password: "secret", database: "mydb" },
      };
      call.mockResolvedValueOnce(mockConnection);

      const result = await fetchConnectionWithCredentials(client, "abc");

      expect(call).toHaveBeenCalledWith("get_connection_by_id", { id: "abc" });
      expect(result).toEqual(mockConnection);
    });

    it("propagates backend errors", async () => {
      call.mockRejectedValueOnce("Connection not found");

      await expect(
        fetchConnectionWithCredentials(client, "unknown"),
      ).rejects.toBe("Connection not found");
    });
  });
});
