/**
 * SSH connection utilities
 * Extracted for testability and reusability
 */

import type {
  SshConnection,
  SshConnectionInput,
  TypedCommandCaller,
} from "../api/contract";
import { TauriTransport } from "../api/transports/tauriTransport";

export type { SshConnection, SshConnectionInput } from "../api/contract";

const legacyTauriClient = new TauriTransport();

function commandClient(client?: TypedCommandCaller): TypedCommandCaller {
  return client ?? legacyTauriClient;
}

/**
 * Load all SSH connections
 */
export async function loadSshConnections(
  client?: TypedCommandCaller,
): Promise<SshConnection[]> {
  try {
    return await commandClient(client).call("get_ssh_connections", undefined);
  } catch (error) {
    console.error("Failed to load SSH connections:", error);
    return [];
  }
}

/**
 * Normalize SSH params: normalize empty strings to undefined
 */
function normalizeSshParams(ssh: Partial<SshConnection>): Partial<SshConnection> {
  const result: Partial<SshConnection> = { ...ssh };

  // Normalize empty strings to undefined for all optional fields
  if (ssh.key_file !== undefined && !ssh.key_file?.trim()) {
    result.key_file = undefined;
  }

  if (ssh.password !== undefined && !ssh.password?.trim()) {
    result.password = undefined;
  }

  if (ssh.key_passphrase !== undefined && !ssh.key_passphrase?.trim()) {
    result.key_passphrase = undefined;
  }

  return result;
}

/**
 * Save a new SSH connection
 */
export async function saveSshConnection(
  name: string,
  ssh: SshConnectionInput,
  client?: TypedCommandCaller,
): Promise<SshConnection> {
  return await commandClient(client).call("save_ssh_connection", {
    name,
    ssh: normalizeSshParams(ssh),
  });
}

/**
 * Update an existing SSH connection
 */
export async function updateSshConnection(
  id: string,
  name: string,
  ssh: SshConnectionInput,
  client?: TypedCommandCaller,
): Promise<SshConnection> {
  return await commandClient(client).call("update_ssh_connection", {
    id,
    name,
    ssh: normalizeSshParams(ssh),
  });
}

/**
 * Delete an SSH connection
 */
export async function deleteSshConnection(
  id: string,
  client?: TypedCommandCaller,
): Promise<void> {
  await commandClient(client).call("delete_ssh_connection", { id });
}

/**
 * Test an SSH connection
 * @param options.dbConnectionId Saved database connection whose inline SSH
 *   secrets (stored in the keychain under the DB connection id) may be used
 *   as a fallback when the form did not re-enter them.
 * @returns Success message if connection works
 * @throws Error with message if connection fails
 */
export async function testSshConnection(
  ssh: Partial<SshConnection>,
  options: { dbConnectionId?: string; progressId?: string } = {},
  client?: TypedCommandCaller,
): Promise<string> {
  return await commandClient(client).call(
    "test_ssh_connection",
    {
      ssh: {
        ...normalizeSshParams(ssh),
        connection_id: ssh.id,
        db_connection_id: options.dbConnectionId,
        progress_id: options.progressId,
      },
    },
    { deadlineMs: 180_000 },
  );
}

/**
 * Format an SSH connection for display
 */
export function formatSshConnectionString(ssh: SshConnection): string {
  return `${ssh.user}@${ssh.host}:${ssh.port}`;
}

/**
 * Validate SSH connection parameters
 */
export interface SshValidationResult {
  isValid: boolean;
  error?: string;
}

export function validateSshConnection(
  ssh: Partial<SshConnection>,
  options: { allowEmptyPassword?: boolean } = {}
): SshValidationResult {
  const { allowEmptyPassword = false } = options;
  if (!ssh.name || ssh.name.trim() === "") {
    return { isValid: false, error: "Connection name is required" };
  }

  if (!ssh.host || ssh.host.trim() === "") {
    return { isValid: false, error: "SSH host is required" };
  }

  if (!ssh.user || ssh.user.trim() === "") {
    return { isValid: false, error: "SSH user is required" };
  }

  if (ssh.port !== undefined && (ssh.port < 1 || ssh.port > 65535)) {
    return { isValid: false, error: "SSH port must be between 1 and 65535" };
  }

  if (!ssh.auth_type) {
    return { isValid: false, error: "Authentication type is required" };
  }

  // Validate based on auth type
  if (ssh.auth_type === "password" && !allowEmptyPassword) {
    if (!ssh.password || ssh.password.trim() === "") {
      return { isValid: false, error: "Password is required for password authentication" };
    }
  }
  // For ssh_key type, both key_file and key_passphrase are optional

  return { isValid: true };
}
