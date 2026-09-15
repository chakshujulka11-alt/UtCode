import { randomUUID } from "node:crypto";
import type { AgentEvent, RestoreResult } from "../../shared/types";
import { MAX_PARALLEL_AGENTS } from "../../shared/constants";
import { logger } from "../services/logger";
import { settingsStore } from "../services/settingsStore";
import { providerManager } from "../providers/providers";
import { runAgentLoop } from "./agentLoop";
import { decideRoute } from "./modelRouter";
import { ToolRegistry, type AgentTool } from "../tools/toolTypes";
import { createNativeTools } from "../tools/nativeTools";
import { mcpManager } from "../mcp/mcpManager";
import { workspaceService } from "../workspace/workspaceService";
import { terminalService } from "../terminal/terminalService";
import { snapshotManager } from "../fileSystem/snapshotManager";
import { workspaceLocks } from "./workspaceLocks";
import { vectorStore } from "./vectorStore";
import { fileWatcher } from "../fileSystem/fileWatcher";
import type { UnifiedMessage } from "../providers/providerTypes";

interface ActiveRun {
  runId: string;
  chatId: string;
  controller: AbortController;
  startedAt: number;
  emit: (event: AgentEvent) => void;
}

class AgentManager {
  private runs = new Map<string, ActiveRun>();
  private chatOf = new Map<string, string>();

  isBusy(): boolean {
    return this.runs.size > 0;
  }

  activeRuns(): { runId: string; chatId: string; startedAt: number }[] {
    return [...this.runs.values()].map((r) => ({ runId: r.runId, chatId: r.chatId, startedAt: r.startedAt }));
  }

  buildToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    const native: AgentTool[] = createNativeTools();
    for (const tool of native) registry.register(tool);
    for (const tool of mcpManager.allAgentTools()) {
      if (registry.get(tool.name)) continue;
      registry.register(tool);
    }
    return registry;
  }

  async start(task: string, chatId: string, emit: (event: AgentEvent) => void): Promise<string> {
    if (this.runs.size >= MAX_PARALLEL_AGENTS) {
      throw new Error(`Ghost mode limit reached: ${MAX_PARALLEL_AGENTS} agent tasks are already running. Stop one first.`);
    }
    return this.launch(task.trim(), chatId, emit, null);
  }

  private async launch(task: string, chatId: string, emit: (event: AgentEvent) => void, resumeMessages: UnifiedMessage[] | null): Promise<string> {
    const root = workspaceService.getRoot();
    if (!root) throw new Error("Open a workspace folder before running the agent.");
    if (task.length === 0) throw new Error("The task description is empty.");
    const routing = resumeMessages ? null : decideRoute(settingsStore.get().router, settingsStore.getPublicProviders(), task);
    const provider = providerManager.resolveRuntimeProvider(routing?.providerId ?? null, routing?.model || undefined);
    const registry = this.buildToolRegistry();
    const agentSettings = settingsStore.agentSettings;
    const controller = new AbortController();
    const runId = randomUUID();
    const active: ActiveRun = { runId, chatId, controller, startedAt: Date.now(), emit };
    this.runs.set(runId, active);
    this.chatOf.set(runId, chatId);
    logger.info("agent", `run ${runId} started on ${root} (chat ${chatId}, resume=${resumeMessages !== null})`);

    const forward = (kind: string, payload: Record<string, unknown> = {}): void => {
      const event = {
        kind,
        runId,
        chatId,
        timestamp: Date.now(),
        ...payload,
        status: typeof payload.status === "string" ? payload.status : undefined
      } as unknown as AgentEvent;
      try {
        emit(event);
      } catch (err) {
        logger.warn("agent", `emit failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    // Gate the file watcher for the duration of this run (ref-counted so
    // parallel ghost-mode runs are all covered). Stops the write->watch->refresh
    // feedback loop that trapped the agent in "re-check" cycles.
    fileWatcher.setAgentWorking(true);
    const loop = runAgentLoop(provider, registry, {
      task,
      workspaceRoot: root,
      runId,
      maxIterations: agentSettings.maxIterations,
      maxOutputPerTool: agentSettings.maxOutputPerTool,
      maxContextChars: agentSettings.maxContextChars,
      tools: registry.definitions(),
      routing,
      pricing: settingsStore.get().pricing,
      resume: resumeMessages !== null,
      initialMessages: resumeMessages ?? undefined,
      onEvent: forward,
      signal: controller.signal
    });

    void loop
      .then((outcome) => {
        logger.info("agent", `run ${runId} finished: ${outcome.status} after ${outcome.iterations} iterations`);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("agent", `run ${runId} crashed: ${message}`);
        forward("error", { text: message });
        forward("agent_finished", { status: "error", text: message });
      })
      .finally(() => {
        this.runs.delete(runId);
        workspaceLocks.release(runId);
        fileWatcher.setAgentWorking(false);
        void mcpManager.restartFailed();
      });

    return runId;
  }

  cancel(runId?: string | null): number {
    const targets = runId ? [this.runs.get(runId)].filter(Boolean) as ActiveRun[] : [...this.runs.values()];
    for (const r of targets) {
      logger.info("agent", `run ${r.runId} cancellation requested`);
      r.controller.abort(new Error("Cancelled by user"));
      terminalService.cancelForRun(r.runId);
      r.emit({ kind: "agent_finished", runId: r.runId, chatId: r.chatId, timestamp: Date.now(), status: "cancelled", text: "Cancelled by user." });
    }
    return targets.length;
  }

  /** Time-machine restore. Cancels the given run if it is still active. */
  async restore(runId: string, callId: string, resume: boolean, emit: (event: AgentEvent) => void): Promise<RestoreResult> {
    const live = this.runs.get(runId);
    if (live) {
      live.controller.abort(new Error("Rolled back by user"));
      for (let i = 0; i < 30 && this.runs.has(runId); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const root = workspaceService.requireRoot();
    fileWatcher.setAgentWorking(true); // time-machine restores can touch many files at once
    let outcome;
    try {
      outcome = await snapshotManager.restore(root, runId, callId);
    } finally {
      fileWatcher.setAgentWorking(false);
    }
    const now = Date.now();
    for (const file of outcome.restoredFiles) {
      emit({
        kind: "file_changed",
        runId: "checkpoint",
        chatId: this.chatOf.get(runId),
        timestamp: now,
        path: file.path,
        after: file.content ?? "",
        operation: file.content === null ? "delete" : "modify",
        summary: "rolled back (time machine)"
      });
    }
    workspaceLocks.release(runId);
    logger.info("agent", `restored run ${runId} to ${callId}: ${outcome.restoredFiles.length} file(s), resume=${resume}`);
    let resumed = false;
    let newRunId: string | undefined;
    if (resume && outcome.messages && outcome.messages.length > 0) {
      const chatId = this.chatOf.get(runId) ?? "legacy";
      newRunId = await this.launch(outcome.task, chatId, emit, structuredClone(outcome.messages));
      resumed = true;
    }
    return {
      restoredFiles: outcome.restoredFiles.map((f) => f.path),
      remainingCheckpoints: outcome.remainingCheckpoints,
      resumed,
      newRunId
    };
  }

  clearAll(): void {
    this.cancel();
    workspaceLocks.releaseAll();
    vectorStore.cancelIndexing();
  }
}

export const agentManager = new AgentManager();
