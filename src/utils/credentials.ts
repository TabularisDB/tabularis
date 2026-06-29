import { invoke } from "@tauri-apps/api/core";

interface ConnectionParams {
  driver: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database: string | string[];
  ssl_mode?: string;
  ssh_enabled?: boolean;
  ssh_connection_id?: string;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_password?: string;
  ssh_key_file?: string;
  ssh_key_passphrase?: string;
  ssh_allow_passphrase_prompt?: boolean;
  save_in_keychain?: boolean;
}

export interface SavedConnectionWithCredentials {
  id: string;
  name: string;
  params: ConnectionParams;
}

export async function fetchConnectionWithCredentials(
  id: string,
): Promise<SavedConnectionWithCredentials> {
  return await invoke<SavedConnectionWithCredentials>("get_connection_by_id", {
    id,
  });
}
