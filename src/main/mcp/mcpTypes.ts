import type { McpServerConfig, McpServerStatus, McpStatus } from "../../shared/types";

export type { McpServerConfig, McpServerStatus, McpStatus };

export interface DiscoveredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpConnectionEvents {
  onStatus: (name: string, status: McpStatus, error?: string) => void;
  onToolDiscovered: (name: string, tool: DiscoveredTool) => void;
}
