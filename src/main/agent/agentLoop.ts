import type { RuntimeAiProvider } from "../providers/providers";
import type { UnifiedMessage } from "../providers/providerTypes";
import { ProviderError } from "../providers/providerTypes";
import { ToolValidationError, validateToolArgs, type ToolRegistry } from "../tools/toolTypes";
import type { AgentLoopOptions, AgentLoopOutcome } from "./agentTypes";
import { buildSystemPrompt } from "./systemPrompt";
import { enforceContextBudget, estimateMessageChars } from "./contextManager";
import { describeToolTarget } from "../tools/toolTargets";
import { snapshotManager } from "../fileSystem/snapshotManager";
import { logger } from "../services/logger";

export { ToolValidationError };

const CANCELLED_TEXT = "[command cancelled by user]";

/** Narration that promises a future action ("let me…", "I'll…") — used to
 * distinguish a mid-task announcement from a genuine final summary. */
const INTENT_WITHOUT_ACTION_RE =
  /\b(let me\b|i'?ll\b|i will\b|i now will\b|now i (?:will|'ll|am going to)\b|next[, ]+i(?:'| )ll\b|next,? i will\b|first,? i(?:'| wi?ll)\b|i(?:'m| am) going to\b|i need to\b|time for me to\b|let's now\b)\b/iu;

export async function runAgentLoop(
  provider: RuntimeAiProvider,
  registry: ToolRegistry,
  opts: AgentLoopOptions
): Promise<AgentLoopOutcome> {
  const { runId, signal } = opts;
  const emit = (kind: string, payload: Record<string, unknown> = {}): void => {
    opts.onEvent(kind, { runId, ...payload });
  };

  const messages: UnifiedMessage[] = [];
  if (opts.resume && opts.initialMessages && opts.initialMessages.length > 0) {
    messages.push(...opts.initialMessages);
  } else {
    messages.push({ role: "system", content: buildSystemPrompt(opts.workspaceRoot) });
    if (opts.initialMessages && opts.initialMessages.length > 0) {
      for (const m of opts.initialMessages) {
        if (m.role !== "system") messages.push(m);
      }
    }
    const taskMsg = `${opts.task}${opts.activeFile ? `\n\n(User currently has ${opts.activeFile} open in the editor.)` : ""}`;
    messages.push({ role: "user", content: taskMsg });
  }

  emit("agent_started", {
    text: opts.resume ? "Resuming from checkpoint — workspace files rolled back, continuing the same task…" : `Task received: ${truncate(opts.task, 160)}`,
    status: "running"
  });
  if (opts.routing) {
    emit("thinking", { text: opts.routing.reason, tier: opts.routing.tier, model: opts.routing.model });
  }

  const recentCalls: string[] = [];
  let iterations = 0;
  let lastText = "";
  let identicalStreak = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  let wrapUpMode = false;
  let emptyNudged = false;
  let narrationNudges = 0;

  while (iterations < opts.maxIterations) {
    if (signal.aborted) {
      emit("agent_finished", { status: "cancelled", text: lastText });
      return { status: "cancelled", finalText: lastText, iterations };
    }
    iterations++;
    const budget = enforceContextBudget(messages, opts.maxContextChars);
    if (budget.compacted) {
      logger.info("agent", `run ${runId}: context compacted to ${budget.chars} chars at iteration ${iterations}`);
    }
    if (!wrapUpMode && budget.chars / Math.max(1, opts.maxContextChars) > 0.9) {
      wrapUpMode = true;
      messages.push({
        role: "user",
        content:
          "You have nearly filled the working context. Produce your FINAL wrap-up message now: summarize what you completed, what remains and the exact next steps. Do not call any more tools."
      });
      logger.info("agent", `run ${runId}: entered 90% context wrap-up mode`);
    }
    emit("thinking", { text: `Iteration ${iterations}/${opts.maxIterations}: deciding next action…` });

    let response;
    try {
      response = await provider.complete({
        model: "",
        messages: budget.messages,
        tools: opts.tools,
        temperature: provider.temperature,
        maxTokens: provider.maxTokens,
        signal,
        onTextDelta: (delta) => emit("text_delta", { text: delta })
      });
    } catch (err) {
      if (signal.aborted || isAbortError(err)) {
        emit("agent_finished", { status: "cancelled", text: lastText });
        return { status: "cancelled", finalText: lastText, iterations };
      }
      const message = err instanceof Error ? err.message : String(err);
      emit("error", { text: message });
      logger.error("agent", `run ${runId} provider failure: ${message}`);
      emit("agent_finished", { status: "error", text: message });
      return { status: "error", finalText: message, iterations };
    }

    lastText = response.text || lastText;
    const estIn = Math.round(estimateMessageChars(budget.messages) / 4);
    const estOut = Math.round((response.text.length + JSON.stringify(response.toolCalls ?? []).length) / 4);
    const realIn = response.usage?.promptTokens;
    const realOut = response.usage?.completionTokens;
    totalPrompt += realIn ?? estIn;
    totalCompletion += realOut ?? estOut;
    const priceIn = opts.routing ? opts.routing.priceInUsd : opts.pricing?.inUsdPerM ?? 0;
    const priceOut = opts.routing ? opts.routing.priceOutUsd : opts.pricing?.outUsdPerM ?? 0;
    const totalCost = (totalPrompt * priceIn) / 1_000_000 + (totalCompletion * priceOut) / 1_000_000;
    emit("usage", {
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      costUsd: totalCost,
      contextPct: Math.min(1, budget.chars / Math.max(1, opts.maxContextChars)),
      model: opts.routing?.model || provider.model,
      tier: opts.routing?.tier,
      estimated: realIn === undefined && realOut === undefined
    });
    if (response.finishReason === "length" && response.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: response.text });
      messages.push({
        role: "user",
        content: "Your previous response was cut off because it was too long. Continue, and prefer tool calls or shorter output."
      });
      continue;
    }

    if (response.toolCalls.length === 0) {
      if (response.text.trim().length === 0) {
        // The silent-stop case (e.g. Gemini returning an empty candidate after a
        // tool call): nudge once instead of ending with nothing visible; if it
        // happens twice in a row, stop with an EXPLICIT message, never silence.
        if (!emptyNudged) {
          emptyNudged = true;
          messages.push({ role: "assistant", content: "" });
          messages.push({
            role: "user",
            content: "Your last response was empty. Either continue the task with tool calls, or reply with a short final summary of the current state."
          });
          emit("thinking", { text: "The model returned an empty reply — prompting it to continue…" });
          continue;
        }
        const fallback = "The model stopped responding with content (empty reply). Nothing was lost — send “continue” and the agent will pick up where it left off.";
        messages.push({ role: "assistant", content: fallback });
        emit("agent_finished", { status: "completed", text: fallback });
        return { status: "completed", finalText: fallback, iterations };
      }
      messages.push({ role: "assistant", content: response.text });
      if (
        narrationNudges < 2 &&
        !wrapUpMode &&
        INTENT_WITHOUT_ACTION_RE.test(response.text)
      ) {
        // BUG 1 guard: the model narrated a future action and stopped. A missing
        // tool call must NOT be interpreted as "task complete" — nudge it to act.
        narrationNudges += 1;
        messages.push({
          role: "user",
          content:
            "You described actions you intend to take but did not call any tools. The actions are already approved — execute them NOW with tool calls. If everything is genuinely finished instead, send a final summary of completed work with no future intentions."
        });
        emit("thinking", { text: "Narration without action detected — prompting the model to act with tools…" });
        logger.info("agent", `run ${runId}: narration-without-action nudge #${narrationNudges}`);
        continue;
      }
      emit("agent_finished", { status: "completed", text: response.text });
      return { status: "completed", finalText: response.text, iterations };
    }

    if (wrapUpMode) {
      // Already asked to wrap up and it still wants tools — stop gracefully without exposing internals.
      messages.push({ role: "assistant", content: response.text });
      emit("agent_finished", { status: "completed", text: response.text || "Stopped: context budget reached; progress summarized." });
      return { status: "completed", finalText: response.text, iterations };
    }

    const batchSnapshot = structuredClone(messages);
    messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });

    for (const call of response.toolCalls) {
      if (signal.aborted) {
        emit("agent_finished", { status: "cancelled", text: lastText });
        return { status: "cancelled", finalText: lastText, iterations };
      }
      snapshotManager.start({
        runId,
        callId: call.id,
        toolName: call.name,
        task: opts.task,
        workspaceRoot: opts.workspaceRoot,
        timestamp: Date.now(),
        messages: batchSnapshot
      });
      const signature = `${call.name}|${JSON.stringify(call.arguments)}`;
      recentCalls.push(signature);
      if (recentCalls.length > 6) recentCalls.shift();
      identicalStreak = recentCalls[recentCalls.length - 1] === signature && countTail(recentCalls, signature) >= 3 ? identicalStreak + 1 : 0;

      const tool = registry.get(call.name);
      const started = Date.now();
      emit("tool_started", {
        toolName: call.name,
        callId: call.id,
        args: call.arguments,
        target: tool ? describeToolTarget(call.name, call.arguments) : ""
      });

      let resultContent = "";
      let okResult = true;
      if (!tool) {
        okResult = false;
        resultContent = `Error: Unknown tool "${call.name}". Available tools: ${registry.list().map((t) => t.name).join(", ")}.`;
      } else if (call.rawArguments) {
        okResult = false;
        resultContent = `Error: Malformed JSON arguments for tool "${call.name}". Fix the JSON and retry.`;
      } else {
        try {
          validateToolArgs(call.name, tool.parameters, call.arguments);
        } catch (err) {
          okResult = false;
          resultContent = err instanceof Error ? `Error: ${err.message}` : `Error: ${String(err)}`;
        }
        if (okResult) {
          try {
            const result = await tool.execute(call.arguments, {
              workspaceRoot: opts.workspaceRoot,
              runId,
              callId: call.id,
              signal,
              emitEvent: (kind, payload) => emit(kind, payload)
            });
            resultContent = result.content;
            okResult = result.ok;
          } catch (err) {
            okResult = false;
            resultContent = err instanceof Error ? `Error: ${err.message}` : `Error: ${String(err)}`;
            if (signal.aborted) resultContent = CANCELLED_TEXT;
          }
        }
      }

      const truncated = truncateForModel(resultContent, opts.maxOutputPerTool);
      messages.push({ role: "tool", content: truncated, toolCallId: call.id, toolName: call.name });
      emit("tool_result", {
        toolName: call.name,
        callId: call.id,
        ok: okResult,
        durationMs: Date.now() - started,
        result: preview(truncated)
      });
      if (snapshotManager.finish(runId, call.id)) {
        snapshotManager.pruneMessages();
        emit("checkpoint", {
          callId: call.id,
          toolName: call.name,
          remaining: snapshotManager.count(runId)
        });
      }

      if (!okResult) {
        messages.push({
          role: "user",
          content: `The tool "${call.name}" failed. Read the error above, adjust your approach (re-read the file, fix arguments, try a different command) and continue.`
        });
      }

      if (identicalStreak >= 2) {
        messages.push({
          role: "user",
          content: `You have repeated the exact same ${call.name} call ${countTail(recentCalls, signature)} times without progress. Do not repeat it. Change strategy or finish with what you know.`
        });
      }
      if (countTail(recentCalls, signature) >= 4) {
        emit("error", { text: `Stopped: repeated identical ${call.name} call detected (possible loop).` });
        emit("agent_finished", { status: "error", text: "Agent stopped: infinite loop protection triggered." });
        return { status: "error", finalText: "Agent stopped: infinite loop protection triggered.", iterations };
      }
    }
  }

  emit("agent_finished", {
    status: "max_iterations",
    text: `Stopped after ${opts.maxIterations} iterations without a final answer.`
  });
  return { status: "max_iterations", finalText: lastText, iterations };
}

function countTail(list: string[], signature: string): number {
  let n = 0;
  for (let i = list.length - 1; i >= 0 && list[i] === signature; i--) n++;
  return n;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function preview(s: string): string {
  return s.length <= 800 ? s : s.slice(0, 600) + "\n…" + s.slice(-180);
}

function truncateForModel(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const half = Math.floor(maxChars / 2);
  return (
    content.slice(0, half) +
    `\n\n[... ${content.length - maxChars} chars truncated to protect the context window ...]\n\n` +
    content.slice(content.length - half)
  );
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || /abort|cancel/i.test(err.message));
}

export { ProviderError };
