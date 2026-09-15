import type { McpConnection } from "./mcpClient";
import type { AgentTool, ToolContext, ToolResult } from "../tools/toolTypes";
import { truncateToolOutput } from "../tools/toolTypes";
import { logger } from "../services/logger";
import { settingsStore } from "../services/settingsStore";

export function mcpToolNamespacedName(serverName: string, toolName: string): string {
  return `mcp.${serverName}.${toolName}`;
}

export function createMcpTools(connection: McpConnection): AgentTool[] {
  return connection.tools.map((tool) => {
    const namespaced = mcpToolNamespacedName(connection.config.name, tool.name);
    return {
      source: "mcp" as const,
      name: namespaced,
      description: `[MCP server "${connection.config.name}"] ${tool.description || tool.name}`,
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
      async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        try {
          const result = await connection.callTool(tool.name, args);
          void ctx;
          const max = settingsStore.agentSettings.maxOutputPerTool;
          if (result.isError) {
            return { ok: false, content: `MCP tool ${namespaced} returned an error:\n${truncateToolOutput(result.text, max)}` };
          }
          return { ok: true, content: truncateToolOutput(result.text, max) };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn("mcp", `tool ${namespaced} failed: ${message}`);
          return {
            ok: false,
            content: `Error: MCP server "${connection.config.name}" tool call failed: ${message}. The server may have disconnected; continue with an alternative approach.`
          };
        }
      }
    } satisfies AgentTool;
  });
}
