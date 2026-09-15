import type { UnifiedMessage } from "../providers/providerTypes";
import type { ToolDefinition } from "../../shared/types";
import type { RoutingDecision } from "./modelRouter";

export type AgentStatus = "idle" | "running" | "cancelling" | "finished" | "error";

export interface AgentLoopOptions {
  task: string;
  workspaceRoot: string;
  runId: string;
  maxIterations: number;
  maxOutputPerTool: number;
  maxContextChars: number;
  tools: ToolDefinition[];
  initialMessages?: UnifiedMessage[];
  onEvent: (kind: string, payload?: Record<string, unknown>) => void;
  signal: AbortSignal;
  activeFile?: string | null;
  routing?: RoutingDecision | null;
  resume?: boolean;
  pricing?: { inUsdPerM: number; outUsdPerM: number };
}

export interface AgentLoopOutcome {
  status: "completed" | "cancelled" | "max_iterations" | "error";
  finalText: string;
  iterations: number;
}

export interface AgentRunState {
  runId: string;
  task: string;
  status: AgentStatus;
  iteration: number;
  startedAt: number;
  contextChars: number;
}
