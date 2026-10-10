/** Kind of prompt ssh is asking for, mirrored from the Rust askpass module. */
export type SshAskpassKind = "secret" | "confirm" | "notify";

/** Payload of the `ssh-askpass://request` Tauri event. */
export interface SshAskpassRequest {
  id: number;
  kind: SshAskpassKind;
  prompt: string;
}
