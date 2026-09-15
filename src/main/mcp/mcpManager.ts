import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { MCP_CONFIG_FILE } from "../../shared/constants";
import type { McpServerConfig, McpServerStatus } from "../../shared/types";
import { logger } from "../services/logger";
import { settingsStore } from "../services/settingsStore";
import { McpConnection } from "./mcpClient";
import { createMcpTools } from "./mcpToolAdapter";
import type { AgentTool } from "../tools/toolTypes";

export type McpEventSink = (kind: string, payload: Record<string, unknown>) => void;

interface ConfigFileShape {
  servers?: Record<string, Partial<McpServerConfig> & { url?: string; transport?: string }>;
  mcpServers?: Record<string, Partial<McpServerConfig> & { url?: string; transport?: string }>;
}

export function validateMcpServerConfig(raw: { name: string; command: string; args?: string[]; env?: Record<string, string>; cwd?: string; disabled?: boolean }): McpServerConfig {
  const name = String(raw.name ?? "").trim();
  if (!/^[A-Za-z0-9_.-]{1,48}$/.test(name)) {
    throw new Error(`Invalid MCP server name "${name}". Use letters, digits, dot, dash or underscore (max 48 chars).`);
  }
  const command = String(raw.command ?? "").trim();
  if (command.length === 0) throw new Error(`MCP server "${name}" requires a command.`);
  if (/[&|<>`$]/.test(command)) {
    throw new Error(`MCP server "${name}" command contains characters that look like shell injection.`);
  }
  const args = Array.isArray(raw.args) ? raw.args.map((a) => String(a)) : [];
  return { name, command, args, env: raw.env, cwd: raw.cwd, disabled: raw.disabled === true };
}

class McpManager {
  private connections = new Map<string, McpConnection>();
  private servers = new Map<string, McpServerConfig>();
  private sink: McpEventSink = () => undefined;
  private loaded = false;

  setEventSink(sink: McpEventSink): void {
    this.sink = sink;
  }

  private get configPath(): string {
    return settingsStore.get().mcpConfigPath || path.join(app.getPath("userData"), MCP_CONFIG_FILE);
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const file = this.configPath;
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as ConfigFileShape;
        const entries = parsed.servers ?? parsed.mcpServers ?? {};
        for (const [name, def] of Object.entries(entries)) {
          if (def.url || def.transport) {
            logger.warn("mcp", `server ${name}: only stdio transport is supported right now; entry skipped`);
            continue;
          }
          try {
            const cfg = validateMcpServerConfig({ ...(def as McpServerConfig), name });
            this.servers.set(name, cfg);
          } catch (err) {
            logger.warn("mcp", `invalid config for ${name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } catch (err) {
      logger.error("mcp", `failed to load config: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private persist(): void {
    try {
      const file = this.configPath;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const out: ConfigFileShape = { servers: {} };
      for (const [name, cfg] of this.servers) {
        out.servers![name] = { command: cfg.command, args: cfg.args, env: cfg.env, cwd: cfg.cwd, disabled: cfg.disabled };
      }
      fs.writeFileSync(file, JSON.stringify(out, null, 2), "utf-8");
    } catch (err) {
      logger.error("mcp", `failed to persist config: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private emitEvent(status: string, extra: Record<string, unknown> = {}): void {
    this.sink("mcp_event", { status, ...extra });
  }

  listServers(): McpServerConfig[] {
    this.load();
    return [...this.servers.values()];
  }

  statuses(): McpServerStatus[] {
    this.load();
    return [...this.servers.values()].map((cfg) => this.statusFor(cfg));
  }

  saveServer(raw: McpServerConfig): void {
    this.load();
    const cfg = validateMcpServerConfig(raw);
    const previous = this.connections.get(cfg.name);
    if (previous) {
      void previous.disconnect().catch(() => undefined);
      this.connections.delete(cfg.name);
    }
    this.servers.set(cfg.name, cfg);
    this.persist();
    this.emitEvent("config_saved", { server: cfg.name });
  }

  deleteServer(name: string): void {
    this.load();
    const conn = this.connections.get(name);
    if (conn) {
      void conn.disconnect().catch(() => undefined);
      this.connections.delete(name);
    }
    this.servers.delete(name);
    this.persist();
    this.emitEvent("config_removed", { server: name });
  }

  async connect(name: string): Promise<McpServerStatus> {
    this.load();
    const cfg = this.servers.get(name);
    if (!cfg) throw new Error(`Unknown MCP server: ${name}`);
    if (cfg.disabled) throw new Error(`MCP server "${name}" is disabled. Enable it before connecting.`);
    const existing = this.connections.get(name);
    if (existing && existing.status === "connected") return this.statusFor(cfg);
    const conn = new McpConnection(cfg, {
      onStatus: (serverName, status, error) => {
        this.emitEvent(status, { server: serverName, error, toolCount: this.connections.get(serverName)?.tools.length ?? 0 });
      },
      onToolDiscovered: (serverName, tool) => {
        this.emitEvent("tool_discovered", { server: serverName, tool: tool.name });
      }
    });
    this.connections.set(name, conn);
    await conn.connect();
    return this.statusFor(cfg);
  }

  async disconnect(name: string): Promise<McpServerStatus> {
    this.load();
    const conn = this.connections.get(name);
    if (conn) {
      await conn.disconnect();
      this.connections.delete(name);
    }
    const cfg = this.servers.get(name);
    if (!cfg) throw new Error(`Unknown MCP server: ${name}`);
    this.emitEvent("disconnected", { server: name });
    return { name, status: "stopped", toolCount: 0 };
  }

  async connectAllEnabled(): Promise<void> {
    this.load();
    for (const cfg of this.servers.values()) {
      if (cfg.disabled) continue;
      try {
        await this.connect(cfg.name);
      } catch (err) {
        logger.warn("mcp", `auto-connect ${cfg.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [name, conn] of [...this.connections]) {
      try {
        await conn.disconnect();
      } catch {
        /* ignore */
      }
      this.connections.delete(name);
    }
  }

  toolsFor(name: string): { name: string; description: string }[] {
    this.load();
    return this.connections.get(name)?.tools.map((t) => ({ name: t.name, description: t.description })) ?? [];
  }

  allAgentTools(): AgentTool[] {
    this.load();
    const out: AgentTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.status === "connected") out.push(...createMcpTools(conn));
    }
    return out;
  }

  async restartFailed(): Promise<void> {
    for (const [name, conn] of this.connections) {
      if (conn.status === "error") {
        this.connections.delete(name);
        try {
          await this.connect(name);
        } catch {
          /* remains errored */
        }
      }
    }
  }

  importFromFile(filePath: string): McpServerConfig[] {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ConfigFileShape;
    const entries = parsed.servers ?? parsed.mcpServers ?? {};
    const imported: McpServerConfig[] = [];
    for (const [name, def] of Object.entries(entries)) {
      if (def.url || def.transport) continue;
      try {
        const cfg = validateMcpServerConfig({ ...(def as McpServerConfig), name });
        this.servers.set(name, cfg);
        imported.push(cfg);
      } catch (err) {
        logger.warn("mcp", `import skipped ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.persist();
    this.emitEvent("imported", { count: imported.length });
    return imported;
  }

  private statusFor(cfg: McpServerConfig): McpServerStatus {
    const conn = this.connections.get(cfg.name);
    return {
      name: cfg.name,
      status: conn?.status ?? "stopped",
      toolCount: conn?.tools.length ?? 0,
      error: conn?.status === "error" ? "Connection failed or server exited. Try disconnect/connect." : undefined
    };
  }
}

export const mcpManager = new McpManager();
