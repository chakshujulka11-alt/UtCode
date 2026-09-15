import { afterEach, describe, expect, it } from "vitest";
import { geminiProvider } from "../src/main/providers/geminiProvider";
import type { ChatCompletionRequest, ProviderRuntimeConfig } from "../src/main/providers/providerTypes";

const originalFetch = globalThis.fetch;

function sse(chunks: unknown[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
      controller.close();
    }
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const config: ProviderRuntimeConfig = { type: "gemini", model: "gemini-2.5-flash", apiKey: "k", baseUrl: undefined, temperature: 0.2, maxTokens: 1024 };

function req(messages: ChatCompletionRequest["messages"]): ChatCompletionRequest {
  return { model: "gemini-2.5-flash", messages, tools: [], temperature: 0.2, maxTokens: 1024 };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Gemini provider — thinking model handling", () => {
  it("drops thought parts from the visible text but keeps real text and tool calls", async () => {
    globalThis.fetch = (async () =>
      sse([
        { candidates: [{ content: { parts: [{ text: "internal reasoning", thought: true }] } }] },
        { candidates: [{ content: { parts: [{ text: "Hello " }] } }] },
        { candidates: [{ content: { parts: [{ text: "world" }] } }] },
        { candidates: [{ content: { parts: [{ text: "more thinking", thought: true }] } }] },
        { candidates: [{ content: { parts: [{ functionCall: { name: "read_file", args: { path: "a.ts" } }, thoughtSignature: "SIG123" }] } }] },
        { candidates: [{ finishReason: "STOP" }] }
      ])) as unknown as typeof fetch;

    let streamed = "";
    const out = await geminiProvider.complete(config, {
      ...req([{ role: "user", content: "hi" }]),
      onTextDelta: (d) => {
        streamed += d;
      }
    });
    expect(out.text).toBe("Hello world");
    expect(streamed).toBe("Hello world");
    expect(out.text).not.toContain("reasoning");
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].name).toBe("read_file");
    expect(out.toolCalls[0].thoughtSignature).toBe("SIG123");
    expect(out.finishReason).toBe("tool_calls");
  });

  it("echoes the function call thoughtSignature back on the next request", async () => {
    let sentBody: unknown = null;
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      sentBody = JSON.parse(String(init?.body));
      return sse([{ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }]);
    }) as unknown as typeof fetch;

    await geminiProvider.complete(
      config,
      req([
        { role: "user", content: "hi" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.ts" }, thoughtSignature: "SIG123" }] },
        { role: "tool", content: "file body", toolCallId: "c1", toolName: "read_file" }
      ])
    );
    const contents = (sentBody as { contents: { role: string; parts: { functionCall?: { name?: string } }[] }[] }).contents;
    const modelMsg = contents.find((c) => c.role === "model");
    const fcPart = modelMsg?.parts.find((p) => p.functionCall);
    expect((fcPart as unknown as { thoughtSignature?: string }).thoughtSignature).toBe("SIG123");
  });

  it("raises a clear error instead of looping when the response is safety-blocked with no content", async () => {
    globalThis.fetch = (async () => sse([{ candidates: [{ finishReason: "SAFETY" }] }])) as unknown as typeof fetch;
    await expect(geminiProvider.complete(config, req([{ role: "user", content: "hi" }]))).rejects.toThrow(/blocked/i);
  });
});
