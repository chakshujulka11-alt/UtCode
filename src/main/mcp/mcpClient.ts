import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpConnectionEvents, McpServerConfig } from "./mcpTypes";
import type { McpStatus } from "../../shared/types";
import { logger } from "../services/logger";

export class McpConnection {
  readonly config: McpServerConfig;
  status: McpStatus = "stopped";
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[] = [];
  private readonly events: McpConnectionEvents;

  constructor(config: McpServerConfig, events: McpConnectionEvents) {
    this.config = config;
    this.events = events;
  }

  private setStatus(status: McpStatus, error?: string): void {
    this.status = status;
    this.events.onStatus(this.config.name, status, error);
  }

  async connect(): Promise<void> {
    if (this.status === "connected" || this.status === "connecting") return;
    this.setStatus("connecting");
    try {
      const env: Record<string, string> = { ...(process.env as Record<string, string>), ...(this.config.env ?? {}) };
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        env,
        cwd: this.config.cwd
      });
      this.client = new Client({ name: "utcode", version: "0.1.0" }, { capabilities: {} });
      this.transport.onerror = (err: Error): void => {
        logger.error("mcp", `server ${this.config.name} transport error: ${err.message}`);
        this.setStatus("error", err.message);
      };
      this.transport.onclose = (): void => {
        if (this.status !== "stopped") {
          this.setStatus("error", "Server process exited.");
        }
        this.client = null;
        this.transport = null;
        this.tools = [];
      };
      await this.client.connect(this.transport, { timeout: 20000 });
      const listed = await this.client.listTools();
      this.tools = listed.tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object" }
      }));
      for (const t of this.tools) this.events.onToolDiscovered(this.config.name, t);
      this.setStatus("connected");
      logger.info("mcp", `connected ${this.config.name} with ${this.tools.length} tool(s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("mcp", `connect ${this.config.name} failed: ${message}`);
      this.setStatus("error", message);
      await this.dispose().catch(() => undefined);
      throw new Error(`Could not start MCP server "${this.config.name}": ${message}`);
    }
  }

  async callTool(toolName: string, args: Record<string, unknown>, timeoutMs = 60000): Promise<{ text: string; isError: boolean }> {
    if (!this.client || this.status !== "connected") {
      throw new Error(`MCP server "${this.config.name}" is not connected.`);
    }
    const result = await this.client.callTool({ name: toolName, arguments: args }, undefined, {
      timeout: timeoutMs
    });
    const content = (result.content ?? []) as { type: string; text?: string }[];
    const text = content
      .map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type} content]`))
      .join("\n");
    return { text: text.length ? text : "(empty result)", isError: result.isError === true };
  }

  async disconnect(): Promise<void> {
    this.setStatus("stopped");
    await this.dispose();
  }

  private async dispose(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.transport?.close();
    } catch {
      /* ignore */
    }
    this.client = null;
    this.transport = null;
    this.tools = [];
  }
}
