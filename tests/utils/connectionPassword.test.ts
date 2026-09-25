import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  ConnectionCancelledError,
  isAuthenticationError,
  isConnectionCancelled,
  testSavedConnection,
} from "../../src/utils/connectionPassword";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

const conn = (extra: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "Vault DB",
  params: { driver: "postgres", username: "app", ...extra },
});

const PG_AUTH = 'error returned from database: password authentication failed for user "app"';

/** Make `test_connection` fail with the given errors in order, then succeed. */
function failTestsWith(...errors: string[]) {
  const queue = [...errors];
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd !== "test_connection") return undefined;
    const next = queue.shift();
    if (next !== undefined) throw next;
    return "ok";
  });
}

const calls = (cmd: string) =>
  invokeMock.mock.calls.filter(([name]) => name === cmd).map(([, args]) => args);

describe("connectionPassword", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  describe("isConnectionCancelled", () => {
    it("recognises the cancel error", () => {
      expect(isConnectionCancelled(new ConnectionCancelledError())).toBe(true);
    });

    it("ignores other errors", () => {
      expect(isConnectionCancelled(new Error("Connection cancelled"))).toBe(false);
      expect(isConnectionCancelled("boom")).toBe(false);
    });
  });

  describe("isAuthenticationError", () => {
    it.each([
      PG_AUTH,
      'db error -> FATAL: password authentication failed for user "postgres"',
      "error returned from database: 1045 (28000): Access denied for user 'root'@'172.19.0.1' (using password: YES)",
      "fe_sendauth: no password supplied",
      "error returned from database: 1045 (28000): Access denied for user 'root'@'localhost' (using password: NO)",
      "Token error: 'Login failed for user 'sa'.' on server db executing  on line 1 (code: 18456, state: 1, class: 14)",
      "ORA-01017: invalid username/password; logon denied",
      "WRONGPASS invalid username-password pair or user is disabled.",
      "SCRAM failure: Authentication failed.",
    ])("detects %s", (message) => {
      expect(isAuthenticationError(message)).toBe(true);
    });

    it.each([
      "SSH password authentication failed: Authentication failed",
      "SOCKS5: authentication failed",
      "Access denied. The caller needs ssm:StartSession on this target and on the port-forwarding document.",
      "Connection refused (os error 111)",
      "error returned from database: database \"missing\" does not exist",
      "pool timed out while waiting for an open connection",
    ])("ignores %s", (message) => {
      expect(isAuthenticationError(message)).toBe(false);
    });
  });

  describe("testSavedConnection", () => {
    it("connects with the stored password without prompting", async () => {
      failTestsWith();
      const requestPassword = vi.fn();

      await testSavedConnection(conn(), requestPassword);

      expect(requestPassword).not.toHaveBeenCalled();
      expect(calls("test_connection")).toEqual([
        { request: { params: conn().params, connection_id: "c1" } },
      ]);
      expect(calls("set_connection_password")).toHaveLength(0);
    });

    it("asks for the password when it is rejected and saves the one that works", async () => {
      failTestsWith(PG_AUTH);
      const requestPassword = vi
        .fn()
        .mockResolvedValue({ password: "rotated", remember: true });

      await testSavedConnection(conn(), requestPassword);

      expect(requestPassword).toHaveBeenCalledWith({
        connectionName: "Vault DB",
        username: "app",
        error: PG_AUTH,
      });
      expect(calls("test_connection")[1]).toEqual({
        request: {
          params: { ...conn().params, password: "rotated" },
          connection_id: "c1",
        },
      });
      expect(calls("set_connection_password")).toEqual([
        { connectionId: "c1", password: "rotated", remember: true },
      ]);
    });

    it("passes the choice not to save the password to the backend", async () => {
      failTestsWith(PG_AUTH);
      const requestPassword = vi
        .fn()
        .mockResolvedValue({ password: "rotated", remember: false });

      await testSavedConnection(conn(), requestPassword);

      expect(calls("set_connection_password")).toEqual([
        { connectionId: "c1", password: "rotated", remember: false },
      ]);
    });

    it("keeps asking while the typed password is wrong", async () => {
      failTestsWith(PG_AUTH, "password authentication failed again");
      const requestPassword = vi
        .fn()
        .mockResolvedValueOnce({ password: "wrong", remember: true })
        .mockResolvedValueOnce({ password: "right", remember: true });

      await testSavedConnection(conn(), requestPassword);

      expect(requestPassword).toHaveBeenNthCalledWith(2, {
        connectionName: "Vault DB",
        username: "app",
        error: "password authentication failed again",
      });
      expect(calls("set_connection_password")).toEqual([
        { connectionId: "c1", password: "right", remember: true },
      ]);
    });

    it("throws a cancel error and saves nothing when the prompt is dismissed", async () => {
      failTestsWith(PG_AUTH);
      const requestPassword = vi.fn().mockResolvedValue(null);

      await expect(testSavedConnection(conn(), requestPassword)).rejects.toBeInstanceOf(
        ConnectionCancelledError,
      );
      expect(calls("test_connection")).toHaveLength(1);
      expect(calls("set_connection_password")).toHaveLength(0);
    });

    it("does not prompt for errors unrelated to the password", async () => {
      failTestsWith("Connection refused (os error 111)");
      const requestPassword = vi.fn();

      await expect(testSavedConnection(conn(), requestPassword)).rejects.toBe(
        "Connection refused (os error 111)",
      );
      expect(requestPassword).not.toHaveBeenCalled();
    });

    it("stops prompting when the retry fails for another reason", async () => {
      failTestsWith(PG_AUTH, "Connection refused (os error 111)");
      const requestPassword = vi
        .fn()
        .mockResolvedValue({ password: "typed", remember: true });

      await expect(testSavedConnection(conn(), requestPassword)).rejects.toBe(
        "Connection refused (os error 111)",
      );
      expect(requestPassword).toHaveBeenCalledTimes(1);
      expect(calls("set_connection_password")).toHaveLength(0);
    });

    it("leaves IAM connections to their token flow", async () => {
      failTestsWith("Access denied for user 'app'@'%'");
      const requestPassword = vi.fn();

      await expect(
        testSavedConnection(conn({ use_iam_auth: true }), requestPassword),
      ).rejects.toBe("Access denied for user 'app'@'%'");
      expect(requestPassword).not.toHaveBeenCalled();
    });
  });
});
