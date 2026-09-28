import { invoke } from "@tauri-apps/api/core";
import { toErrorMessage } from "./errors";

export interface PasswordPromptRequest {
  connectionName: string;
  username?: string;
  /** Why the server rejected the previous password, shown above the field. */
  error?: string;
}

export interface PasswordPromptResult {
  password: string;
  /** Save it in the connection; otherwise it is kept until the app quits. */
  remember: boolean;
}

/** Resolves with the typed password, or `null` when the user cancels. */
export type RequestPassword = (
  request: PasswordPromptRequest,
) => Promise<PasswordPromptResult | null>;

/** Thrown when the user dismisses the password prompt instead of connecting. */
export class ConnectionCancelledError extends Error {
  constructor() {
    super("Connection cancelled");
    this.name = "ConnectionCancelledError";
  }
}

export function isConnectionCancelled(error: unknown): boolean {
  return error instanceof ConnectionCancelledError;
}

// Messages database servers and drivers return when the login is rejected.
const AUTH_ERROR_PATTERNS: RegExp[] = [
  /password authentication failed/i, // PostgreSQL
  /no password (was )?(supplied|provided)/i, // PostgreSQL, libpq
  /sasl authentication failed/i, // PostgreSQL SCRAM
  /access denied for user/i, // MySQL / MariaDB
  /\b1045\b.*\b28000\b/, // MySQL ER_ACCESS_DENIED_ERROR
  /login failed for user/i, // SQL Server
  /\bORA-01017\b/i, // Oracle
  /\bWRONGPASS\b|\bNOAUTH\b/, // Redis
  /authentication failed/i, // MongoDB, ClickHouse and others
  /invalid (username or )?password/i,
  /wrong password/i,
];

// Failures of the tunnel or proxy in front of the database: a new database
// password would not fix them.
const TRANSPORT_ERROR_PATTERN = /\bssh\b|socks5|\bssm\b|kubectl|port-forward/i;

/** True when `message` means the database rejected the credentials. */
export function isAuthenticationError(message: string): boolean {
  if (TRANSPORT_ERROR_PATTERN.test(message)) return false;
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

interface TestableConnection {
  id: string;
  name: string;
  params: {
    username?: string;
    use_iam_auth?: boolean;
  };
}

/**
 * Validate a saved connection with `test_connection`. When the server rejects
 * the stored password (missing, wrong or rotated in a vault), ask for a new
 * one and retry, showing the server's error, until the login works or the
 * user cancels. A password that works is handed to the backend, which saves
 * it in the connection or, if the user opted out, keeps it for this session
 * only; either way every command resolving it by id uses it.
 */
export async function testSavedConnection<P extends TestableConnection["params"]>(
  conn: TestableConnection & { params: P },
  requestPassword: RequestPassword,
): Promise<void> {
  try {
    await invoke<string>("test_connection", {
      request: { params: conn.params, connection_id: conn.id },
    });
    return;
  } catch (e) {
    const message = toErrorMessage(e);
    // IAM tokens expire in minutes and have their own flow in the form.
    if (conn.params.use_iam_auth || !isAuthenticationError(message)) throw e;
    return retryWithPromptedPassword(conn, requestPassword, message);
  }
}

async function retryWithPromptedPassword<P extends TestableConnection["params"]>(
  conn: TestableConnection & { params: P },
  requestPassword: RequestPassword,
  firstError: string,
): Promise<void> {
  let error = firstError;
  for (;;) {
    const result = await requestPassword({
      connectionName: conn.name,
      username: conn.params.username,
      error,
    });
    if (result === null) throw new ConnectionCancelledError();
    const { password, remember } = result;

    try {
      await invoke<string>("test_connection", {
        request: {
          params: { ...conn.params, password },
          connection_id: conn.id,
        },
      });
    } catch (e) {
      const message = toErrorMessage(e);
      if (!isAuthenticationError(message)) throw e;
      error = message;
      continue;
    }

    await invoke("set_connection_password", {
      connectionId: conn.id,
      password,
      remember,
    });
    return;
  }
}
