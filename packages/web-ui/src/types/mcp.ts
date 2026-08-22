export interface McpClientStatus {
  client_id: string;
  client_name: string;
  installed: boolean;
  config_path: string | null;
  executable_path: string;
  client_type: "file" | "command";
  manual_command?: string | null;
}
