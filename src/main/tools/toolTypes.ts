import type { ToolDefinition } from "../../shared/types";

export interface ToolResult {
  ok: boolean;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ToolContext {
  workspaceRoot: string;
  runId: string;
  callId: string;
  signal: AbortSignal;
  emitEvent: (kind: string, payload: Record<string, unknown>) => void;
}

export interface AgentTool extends ToolDefinition {
  source: "native" | "mcp";
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolValidationError";
  }
}

type SchemaProp = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: SchemaProp;
  properties?: Record<string, SchemaProp>;
  required?: string[];
};

export function validateToolArgs(
  toolName: string,
  schema: Record<string, unknown>,
  args: unknown
): Record<string, unknown> {
  if (args === undefined || args === null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) {
    throw new ToolValidationError(`Arguments for tool "${toolName}" must be a JSON object.`);
  }
  const obj = args as Record<string, unknown>;
  const s = schema as { type?: string; required?: string[]; properties?: Record<string, SchemaProp> };
  const props = s.properties ?? {};
  for (const required of s.required ?? []) {
    if (obj[required] === undefined || obj[required] === null) {
      throw new ToolValidationError(`Missing required argument "${required}" for tool "${toolName}".`);
    }
  }
  for (const key of Object.keys(obj)) {
    const prop = props[key];
    if (!prop) continue;
    const value = obj[key];
    checkType(toolName, key, value, prop);
  }
  return obj;
}

function checkType(toolName: string, key: string, value: unknown, prop: SchemaProp): void {
  const types = Array.isArray(prop.type) ? prop.type : prop.type ? [prop.type] : [];
  if (types.length > 0) {
    const actual = jsonTypeOf(value);
    if (!types.includes(actual) && !(actual === "integer" && types.includes("number"))) {
      throw new ToolValidationError(
        `Argument "${key}" for tool "${toolName}" must be of type ${types.join(" | ")} but received ${actual}.`
      );
    }
  }
  if (prop.enum && value !== undefined && !prop.enum.includes(value)) {
    throw new ToolValidationError(`Argument "${key}" must be one of: ${prop.enum.map(String).join(", ")}.`);
  }
  if (prop.properties && value && typeof value === "object" && !Array.isArray(value)) {
    for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
      const sub = prop.properties[subKey];
      if (sub) checkType(toolName, `${key}.${subKey}`, subValue, sub);
    }
    for (const required of prop.required ?? []) {
      if ((value as Record<string, unknown>)[required] === undefined) {
        throw new ToolValidationError(`Missing required property "${required}" inside "${key}".`);
      }
    }
  }
  if (prop.items && Array.isArray(value)) {
    for (const item of value) checkType(toolName, `${key}[]`, item, prop.items);
  }
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "number") return Number.isInteger(value) ? "integer" : "number";
  return t;
}

export function truncateToolOutput(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const half = Math.floor(maxChars / 2);
  return (
    content.slice(0, half) +
    `\n\n[... ${content.length - maxChars} characters truncated by utcode to protect the context window ...]\n\n` +
    content.slice(content.length - half)
  );
}

export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  unregisterPrefix(prefix: string): void {
    for (const name of [...this.tools.keys()]) {
      if (name.startsWith(prefix)) this.tools.delete(name);
    }
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool[] {
    return [...this.tools.values()];
  }

  definitions(): ToolDefinition[] {
    return this.list().map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  }
}
