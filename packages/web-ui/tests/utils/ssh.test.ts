import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateSshConnection,
  formatSshConnectionString,
  testSshConnection,
  type SshConnection,
} from "../../src/utils/ssh";

// Mock Tauri's invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("ssh", () => {
  describe("validateSshConnection", () => {
    describe("required fields validation", () => {
      it("should fail when name is missing", () => {
        const ssh: Partial<SshConnection> = {
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "password",
          password: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe("Connection name is required");
      });

      it("should fail when name is empty string", () => {
        const ssh: Partial<SshConnection> = {
          name: "   ",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "password",
          password: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe("Connection name is required");
      });

      it("should fail when host is missing", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          port: 22,
          user: "user",
          auth_type: "password",
          password: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe("SSH host is required");
      });

      it("should fail when host is empty string", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "   ",
          port: 22,
          user: "user",
          auth_type: "password",
          password: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe("SSH host is required");
      });

      it("should fail when user is missing", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          auth_type: "password",
          password: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe("SSH user is required");
      });

      it("should fail when user is empty string", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "   ",
          auth_type: "password",
          password: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe("SSH user is required");
      });
    });

    describe("port validation", () => {
      it("should fail when port is greater than 65535", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 70000,
          user: "user",
          auth_type: "password",
          password: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe("SSH port must be between 1 and 65535");
      });

      it("should fail when port is 0", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 0,
          user: "user",
          auth_type: "password",
          password: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe("SSH port must be between 1 and 65535");
      });

      it("should succeed with default port 22", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "password",
          password: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(true);
      });

      it("should succeed with custom valid port", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 2222,
          user: "user",
          auth_type: "password",
          password: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(true);
      });
    });

    it("should fail when auth_type is missing", () => {
      const ssh: Partial<SshConnection> = {
        name: "My Server",
        host: "example.com",
        port: 22,
        user: "user",
        password: "secret",
      };

      const result = validateSshConnection(ssh);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Authentication type is required");
    });

    describe("password authentication", () => {
      it("should fail when password is missing", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "password",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe(
          "Password is required for password authentication",
        );
      });

      it("should fail when password is empty string", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "password",
          password: "   ",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe(
          "Password is required for password authentication",
        );
      });

      it("should succeed with valid password authentication", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "password",
          password: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(true);
      });

      it("should succeed with password and save_in_keychain enabled", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "password",
          password: "secret",
          save_in_keychain: true,
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(true);
      });

      it("should ignore key_file and key_passphrase when using password auth", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "password",
          password: "secret",
          key_file: "/path/to/key",
          key_passphrase: "keypass",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(true);
      });
    });

    describe("ssh_key authentication", () => {
      it("should succeed with key file only", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "ssh_key",
          key_file: "/path/to/key",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(true);
      });

      it("should succeed with key file and passphrase", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "ssh_key",
          key_file: "/path/to/key",
          key_passphrase: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(true);
      });

      it("should succeed with passphrase only", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "ssh_key",
          key_passphrase: "secret",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(true);
      });

      it("should succeed with no credentials (uses default config or SSH agent)", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "ssh_key",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(true);
      });

      it("should succeed with key file and save_in_keychain for passphrase", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "ssh_key",
          key_file: "/path/to/key",
          key_passphrase: "secret",
          save_in_keychain: true,
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(true);
      });

      it("should succeed with empty key_file string (uses default)", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "ssh_key",
          key_file: "",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(true);
      });

      it("should ignore password field when using ssh_key auth", () => {
        const ssh: Partial<SshConnection> = {
          name: "My Server",
          host: "example.com",
          port: 22,
          user: "user",
          auth_type: "ssh_key",
          key_file: "/path/to/key",
          password: "ignored",
        };

        const result = validateSshConnection(ssh);
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe("formatSshConnectionString", () => {
    it("should format SSH connection string correctly", () => {
      const ssh: SshConnection = {
        id: "1",
        name: "My Server",
        host: "example.com",
        port: 22,
        user: "myuser",
        auth_type: "password",
      };

      expect(formatSshConnectionString(ssh)).toBe("myuser@example.com:22");
    });

    it("should format SSH connection string with custom port", () => {
      const ssh: SshConnection = {
        id: "1",
        name: "My Server",
        host: "example.com",
        port: 2222,
        user: "myuser",
        auth_type: "ssh_key",
      };

      expect(formatSshConnectionString(ssh)).toBe("myuser@example.com:2222");
    });
  });

  describe("testSshConnection", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should call invoke with correct parameters", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue("SSH connection successful");

      const ssh: Partial<SshConnection> = {
        host: "example.com",
        port: 22,
        user: "testuser",
        auth_type: "password",
        password: "secret",
      };

      const result = await testSshConnection(ssh);

      expect(invoke).toHaveBeenCalledWith("test_ssh_connection", {
        ssh: expect.objectContaining({
          host: "example.com",
          port: 22,
          user: "testuser",
          password: "secret",
        }),
      });
      expect(result).toBe("SSH connection successful");
    });

    it("should normalize empty password to undefined", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue("SSH connection successful");

      const ssh: Partial<SshConnection> = {
        host: "example.com",
        port: 22,
        user: "testuser",
        auth_type: "password",
        password: "  ",
      };

      await testSshConnection(ssh);

      expect(invoke).toHaveBeenCalledWith("test_ssh_connection", {
        ssh: expect.objectContaining({
          password: undefined,
        }),
      });
    });

    it("should propagate errors from invoke", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const errorMessage = "Connection refused";
      vi.mocked(invoke).mockRejectedValue(new Error(errorMessage));

      const ssh: Partial<SshConnection> = {
        host: "example.com",
        port: 22,
        user: "testuser",
        auth_type: "password",
        password: "secret",
      };

      await expect(testSshConnection(ssh)).rejects.toThrow(errorMessage);
    });

    it("should handle ssh_key authentication", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockResolvedValue("SSH connection successful");

      const ssh: Partial<SshConnection> = {
        host: "example.com",
        port: 22,
        user: "testuser",
        auth_type: "ssh_key",
        key_file: "/path/to/key",
        key_passphrase: "passphrase",
      };

      const result = await testSshConnection(ssh);

      expect(invoke).toHaveBeenCalledWith("test_ssh_connection", {
        ssh: expect.objectContaining({
          host: "example.com",
          port: 22,
          user: "testuser",
          key_file: "/path/to/key",
          key_passphrase: "passphrase",
        }),
      });
      expect(result).toBe("SSH connection successful");
    });
  });
});
