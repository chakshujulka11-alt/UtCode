import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../src/main/agent/agentLoop";
import { ToolRegistry, type AgentTool, type ToolResult } from "../src/main/tools/toolTypes";
import type { ChatCompletionRequest, ChatCompletionResponse, RuntimeAiProvider } from "../src/main/providers/providers";
import type { ToolCall } from "../src/main/providers/providerTypes";

function fakeProvider(scripts: ChatCompletionResponse[]): RuntimeAiProvider {
  let call = 0;
  const provider = {
    type: "openai",
    temperature: 0,
    maxTokens: 100,
    async complete(_req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
      const script = scripts[Math.min(call, scripts.length - 1)];
      call++;
      return script;
    }
  };
  return provider as unknown as RuntimeAiProvider;
}

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  const echo: AgentTool = {
    source: "native",
    name: "echo_file",
    description: "echo",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    },
    async execute(args): Promise<ToolResult> {
      return { ok: true, content: `echoed ${String(args.path)}` };
    }
  };
  const broken: AgentTool = {
    source: "native",
    name: "broken_tool",
    description: "always fails",
    parameters: { type: "object", properties: {} },
    async execute(): Promise<ToolResult> {
      return { ok: false, content: "Error: simulated failure" };
    }
  };
  registry.register(echo);
  registry.register(broken);
  return registry;
}

function callOf(name: string, args: Record<string, unknown>, id: string): ToolCall {
  return { id, name, arguments: args };
}

describe("runAgentLoop", () => {
  it("completes when the model returns a final message", async () => {
    const collected: string[] = [];
    const outcome = await runAgentLoop(fakeProvider([{ text: "All done.", toolCalls: [], finishReason: "stop" }]), makeRegistry(), {
      task: "do the thing",
      workspaceRoot: "C:\\ws",
      runId: "r1",
      maxIterations: 10,
      maxOutputPerTool: 4000,
      maxContextChars: 100000,
      tools: [],
      onEvent: (kind) => collected.push(kind),
      signal: new AbortController().signal
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.finalText).toBe("All done.");
    expect(collected).toContain("agent_started");
    expect(collected).toContain("agent_finished");
  });

  it("executes a tool call, feeds the result back and finishes", async () => {
    const scripts: ChatCompletionResponse[] = [
      { text: "reading", toolCalls: [callOf("echo_file", { path: "a.ts" }, "c1")], finishReason: "tool_calls" },
      { text: "Done with echo result", toolCalls: [], finishReason: "stop" }
    ];
    let seenToolResult = "";
    const registry = makeRegistry();
    const original = registry.get("echo_file")!;
    registry.register({
      ...original,
      async execute(args, ctx): Promise<ToolResult> {
        const result = await original.execute(args, ctx);
        return result;
      }
    });
    const outcome = await runAgentLoop(fakeProvider(scripts), registry, {
      task: "echo a.ts",
      workspaceRoot: "C:\\ws",
      runId: "r2",
      maxIterations: 10,
      maxOutputPerTool: 4000,
      maxContextChars: 100000,
      tools: registry.definitions(),
      onEvent: (kind, payload) => {
        if (kind === "tool_result") seenToolResult = String(payload?.result ?? "");
      },
      signal: new AbortController().signal
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.iterations).toBe(2);
    expect(seenToolResult).toContain("echoed a.ts");
  });

  it("returns a structured error for unknown tools and keeps going", async () => {
    const scripts: ChatCompletionResponse[] = [
      { text: "", toolCalls: [callOf("does_not_exist", {}, "c1")], finishReason: "tool_calls" },
      { text: "recovered", toolCalls: [], finishReason: "stop" }
    ];
    const results: boolean[] = [];
    const outcome = await runAgentLoop(fakeProvider(scripts), makeRegistry(), {
      task: "t",
      workspaceRoot: "C:\\ws",
      runId: "r3",
      maxIterations: 10,
      maxOutputPerTool: 4000,
      maxContextChars: 100000,
      tools: makeRegistry().definitions(),
      onEvent: (kind, payload) => {
        if (kind === "tool_result") results.push(payload?.ok === true);
      },
      signal: new AbortController().signal
    });
    expect(results).toEqual([false]);
    expect(outcome.status).toBe("completed");
  });

  it("stops repeated identical tool calls via loop protection", async () => {
    const call = callOf("echo_file", { path: "same" }, "cX");
    const provider = fakeProvider(Array(20).fill({ text: "", toolCalls: [call], finishReason: "tool_calls" }));
    const outcome = await runAgentLoop(provider, makeRegistry(), {
      task: "t",
      workspaceRoot: "C:\\ws",
      runId: "r4",
      maxIterations: 30,
      maxOutputPerTool: 4000,
      maxContextChars: 100000,
      tools: makeRegistry().definitions(),
      onEvent: () => undefined,
      signal: new AbortController().signal
    });
    expect(outcome.status).toBe("error");
    expect(outcome.finalText).toContain("loop");
  });

  it("honours cancellation", async () => {
    const controller = new AbortController();
    const registry = makeRegistry();
    const slow: AgentTool = {
      source: "native",
      name: "slow_tool",
      description: "slow",
      parameters: { type: "object", properties: {} },
      async execute(): Promise<ToolResult> {
        controller.abort();
        return { ok: true, content: "finished" };
      }
    };
    registry.register(slow);
    const scripts: ChatCompletionResponse[] = [
      { text: "", toolCalls: [callOf("slow_tool", {}, "c1")], finishReason: "tool_calls" },
      { text: "should not reach", toolCalls: [], finishReason: "stop" }
    ];
    const outcome = await runAgentLoop(fakeProvider(scripts), registry, {
      task: "t",
      workspaceRoot: "C:\\ws",
      runId: "r5",
      maxIterations: 10,
      maxOutputPerTool: 4000,
      maxContextChars: 100000,
      tools: registry.definitions(),
      onEvent: () => undefined,
      signal: controller.signal
    });
    expect(outcome.status).toBe("cancelled");
  });

  it("respects the maximum iterations guard", async () => {
    const call = callOf("echo_file", { path: "p" }, "cid");
    const provider = fakeProvider(Array(50).fill({ text: "", toolCalls: [call], finishReason: "tool_calls" }));
    const outcome = await runAgentLoop(provider, makeRegistry(), {
      task: "t",
      workspaceRoot: "C:\\ws",
      runId: "r6",
      maxIterations: 2,
      maxOutputPerTool: 4000,
      maxContextChars: 100000,
      tools: makeRegistry().definitions(),
      onEvent: () => undefined,
      signal: new AbortController().signal
    });
    expect(["max_iterations", "error"]).toContain(outcome.status);
  });

  it("resume mode replays initialMessages without re-adding the task", async () => {
    let capturedMessages: unknown[] = [];
    let startedText = "";
    const provider = {
      type: "openai",
      temperature: 0,
      maxTokens: 50,
      async complete(req: { messages: unknown[] }) {
        capturedMessages = [...req.messages];
        return { text: "finished after resume", toolCalls: [], finishReason: "stop" as const };
      }
    };
    const events: string[] = [];
    const outcome = await runAgentLoop(provider as never, makeRegistry(), {
      task: "the original task",
      workspaceRoot: "C:\\ws",
      runId: "r7",
      maxIterations: 5,
      maxOutputPerTool: 4000,
      maxContextChars: 100000,
      tools: [],
      resume: true,
      initialMessages: [
        { role: "system", content: "old system prompt" },
        { role: "user", content: "the original task" },
        { role: "assistant", content: "", toolCalls: [{ id: "z", name: "echo_file", arguments: { path: "kept" } }] },
        { role: "tool", content: "echoed kept", toolCallId: "z", toolName: "echo_file" }
      ],
      onEvent: (kind, payload) => {
        events.push(kind);
        if (kind === "agent_started") startedText = String(payload?.text ?? "");
      },
      signal: new AbortController().signal
    });
    expect(outcome.status).toBe("completed");
    expect(startedText).toContain("Resuming from checkpoint");
    expect(capturedMessages).toHaveLength(4);
    const userMsgs = (capturedMessages as { role: string }[]).filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(1);
    expect(events).toContain("agent_finished");
  });

  it("nudges once on an empty final response instead of stopping silently", async () => {
    const scripts: ChatCompletionResponse[] = [
      { text: "", toolCalls: [], finishReason: "stop" },
      { text: "actually done now", toolCalls: [], finishReason: "stop" }
    ];
    const outcome = await runAgentLoop(fakeProvider(scripts), makeRegistry(), {
      task: "hi",
      workspaceRoot: "C:\\ws",
      runId: "r8",
      maxIterations: 6,
      maxOutputPerTool: 4000,
      maxContextChars: 100000,
      tools: [],
      onEvent: () => undefined,
      signal: new AbortController().signal
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.finalText).toBe("actually done now");
    expect(outcome.iterations).toBe(2);
  });

  it("twice-empty stops with an explicit message, never silence", async () => {
    const scripts: ChatCompletionResponse[] = [
      { text: "", toolCalls: [], finishReason: "stop" },
      { text: "   ", toolCalls: [], finishReason: "stop" }
    ];
    const outcome = await runAgentLoop(fakeProvider(scripts), makeRegistry(), {
      task: "hi",
      workspaceRoot: "C:\\ws",
      runId: "r9",
      maxIterations: 6,
      maxOutputPerTool: 4000,
      maxContextChars: 100000,
      tools: [],
      onEvent: () => undefined,
      signal: new AbortController().signal
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.finalText).toContain("empty reply");
  });

  it("does not treat 'Let me write game.js' narration as completion", async () => {
    const scripts: ChatCompletionResponse[] = [
      { text: "Let me write game.js now.", toolCalls: [], finishReason: "stop" },
      { text: "", toolCalls: [callOf("echo_file", { path: "game.js" }, "n1")], finishReason: "tool_calls" },
      { text: "Created game.js and verified it loads.", toolCalls: [], finishReason: "stop" }
    ];
    const outcome = await runAgentLoop(fakeProvider(scripts), makeRegistry(), {
      task: "make a game",
      workspaceRoot: "C:\\ws",
      runId: "rN1",
      maxIterations: 8,
      maxOutputPerTool: 4000,
      maxContextChars: 100000,
      tools: makeRegistry().definitions(),
      onEvent: () => undefined,
      signal: new AbortController().signal
    });
    expect(outcome.iterations).toBe(3);
    expect(outcome.finalText).toBe("Created game.js and verified it loads.");
  });

  it("caps narration nudges and still exits with visible text", async () => {
    const narration: ChatCompletionResponse = { text: "I will now create the file.", toolCalls: [], finishReason: "stop" };
    const scripts = Array(10).fill(narration);
    const outcome = await runAgentLoop(fakeProvider(scripts), makeRegistry(), {
      task: "t",
      workspaceRoot: "C:\\ws",
      runId: "rN2",
      maxIterations: 10,
      maxOutputPerTool: 4000,
      maxContextChars: 100000,
      tools: [],
      onEvent: () => undefined,
      signal: new AbortController().signal
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.iterations).toBeLessThanOrEqual(4);
    expect(outcome.finalText).toContain("create the file");
  });

  it("a genuine past-tense summary completes immediately (no false positive)", async () => {
    const outcome = await runAgentLoop(
      fakeProvider([{ text: "Done — I created index.html and verified it renders.", toolCalls: [], finishReason: "stop" }]),
      makeRegistry(),
      {
        task: "t",
        workspaceRoot: "C:\\ws",
        runId: "rN3",
        maxIterations: 8,
        maxOutputPerTool: 4000,
        maxContextChars: 100000,
        tools: [],
        onEvent: () => undefined,
        signal: new AbortController().signal
      }
    );
    expect(outcome.iterations).toBe(1);
    expect(outcome.status).toBe("completed");
  });
});

describe("concurrent loops (ghost mode isolation)", () => {
  it("two simultaneous runAgentLoop calls keep independent state", async () => {
    const scripts = (id: string): ChatCompletionResponse[] => [
      { text: "", toolCalls: [callOf("echo_file", { path: id }, `${id}-c1`)], finishReason: "tool_calls" },
      { text: `done ${id}`, toolCalls: [], finishReason: "stop" }
    ];
    const eventsA: string[] = [];
    const eventsB: string[] = [];
    const opts = (id: string, collect: (k: string) => void) => ({
      task: `task ${id}`,
      workspaceRoot: "C:\\ws",
      runId: id,
      maxIterations: 6,
      maxOutputPerTool: 4000,
      maxContextChars: 100000,
      tools: makeRegistry().definitions(),
      onEvent: (kind: string, payload?: Record<string, unknown>) => {
        expect(payload?.runId).toBe(id);
        collect(kind);
      },
      signal: new AbortController().signal
    });
    const [a, b] = await Promise.all([
      runAgentLoop(fakeProvider(scripts("A")), makeRegistry(), opts("A", (k) => eventsA.push(k))),
      runAgentLoop(fakeProvider(scripts("B")), makeRegistry(), opts("B", (k) => eventsB.push(k)))
    ]);
    expect(a.finalText).toBe("done A");
    expect(b.finalText).toBe("done B");
    expect(eventsA.filter((k) => k === "tool_result")).toHaveLength(1);
    expect(eventsB.filter((k) => k === "tool_result")).toHaveLength(1);
  });
});