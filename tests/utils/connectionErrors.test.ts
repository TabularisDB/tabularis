import { describe, it, expect } from "vitest";
import {
  classifyConnectionError,
  sanitizeErrorDetail,
} from "../../src/utils/connectionErrors";

describe("sanitizeErrorDetail", () => {
  it("redacts credentials embedded in connection URLs", () => {
    expect(
      sanitizeErrorDetail("failed to connect to mysql://root:s3cret@db.example.com:3306"),
    ).toBe("failed to connect to mysql://root:[redacted]@db.example.com:3306");
  });

  it("redacts password key-value pairs", () => {
    expect(sanitizeErrorDetail("options: host=db password=hunter2 port=5432")).toBe(
      "options: host=db password=[redacted] port=5432",
    );
  });

  it("leaves ordinary messages untouched", () => {
    expect(sanitizeErrorDetail("Connection refused (os error 111)")).toBe(
      "Connection refused (os error 111)",
    );
  });
});

describe("classifyConnectionError", () => {
  it("classifies SSH authentication failures", () => {
    for (const raw of [
      "SSH password auth failed: server rejected",
      "SSH key auth failed: invalid passphrase",
      "SSH authentication failed (authenticated=false)",
      "ssh: Permission denied (publickey,password)",
    ]) {
      const result = classifyConnectionError(raw);
      expect(result.kind).toBe("ssh-auth");
      expect(result.summaryKey).toBe("connectionErrors.ssh-auth.summary");
      expect(result.recoveryKey).toBe("connectionErrors.ssh-auth.recovery");
    }
  });

  it("classifies unreachable SSH servers", () => {
    for (const raw of [
      "Failed to connect to SSH server: connection refused",
      "Timed out waiting for SSH tunnel to establish connection.",
      "SSH process exited prematurely with status: 255.\nStderr: kex_exchange",
      "Failed to launch system ssh: No such file. Ensure 'ssh' is in PATH.",
    ]) {
      expect(classifyConnectionError(raw).kind).toBe("ssh-unreachable");
    }
  });

  it("classifies generic SSH errors", () => {
    expect(classifyConnectionError("Missing SSH Host").kind).toBe("ssh");
  });

  it("classifies database authentication failures", () => {
    for (const raw of [
      "Access denied for user 'root'@'10.0.0.1' (using password: YES)",
      'FATAL: password authentication failed for user "app"',
    ]) {
      expect(classifyConnectionError(raw).kind).toBe("db-auth");
    }
  });

  it("classifies network failures", () => {
    for (const raw of [
      "Connection refused (os error 111)",
      "connection timed out",
      "Name or service not known",
    ]) {
      expect(classifyConnectionError(raw).kind).toBe("network");
    }
  });

  it("points network failures at the tunnel when SSH is enabled", () => {
    const result = classifyConnectionError("Connection refused (os error 111)", {
      sshEnabled: true,
    });
    expect(result.kind).toBe("ssh-unreachable");
  });

  it("classifies missing databases", () => {
    for (const raw of [
      "Unknown database 'shop'",
      'database "shop" does not exist',
      "Database file not found: /tmp/db.sqlite",
    ]) {
      expect(classifyConnectionError(raw).kind).toBe("db-not-found");
    }
  });

  it("falls back to unknown without a recovery hint", () => {
    const result = classifyConnectionError("something exploded");
    expect(result.kind).toBe("unknown");
    expect(result.recoveryKey).toBeNull();
    expect(result.detail).toBe("something exploded");
  });
});
