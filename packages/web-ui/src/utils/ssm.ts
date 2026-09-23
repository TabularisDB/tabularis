/**
 * AWS Systems Manager connection utilities.
 * Manages `aws ssm start-session` port-forwarding tunnels.
 */

import { invoke } from "@tauri-apps/api/core";

export interface SsmTestParams extends Record<string, unknown> {
  target: string;
  profile?: string;
  region?: string;
  /** Host reached through the managed node; a loopback host means the node itself. */
  host: string;
  port: number;
}

/**
 * Test an SSM connection by opening a real port-forwarding session and
 * closing it again.
 */
export async function testSsmConnection(params: SsmTestParams): Promise<string> {
  return await invoke<string>("test_ssm_connection_cmd", params);
}

const LOOPBACK_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1"]);

export type SsmDocument =
  | "AWS-StartPortForwardingSession"
  | "AWS-StartPortForwardingSessionToRemoteHost";

/**
 * Which SSM document a target host resolves to. Mirrors `resolved_document`
 * in `ssm_tunnel.rs`; the backend stays authoritative for what is executed,
 * and the "Test SSM" result echoes the document it actually used.
 */
export function resolveSsmDocument(host: string | undefined): SsmDocument {
  return LOOPBACK_HOSTS.has((host ?? "").trim())
    ? "AWS-StartPortForwardingSession"
    : "AWS-StartPortForwardingSessionToRemoteHost";
}
