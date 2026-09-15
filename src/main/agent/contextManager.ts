import type { UnifiedMessage } from "../providers/providerTypes";

export function estimateMessageChars(messages: UnifiedMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += m.content.length;
    for (const tc of m.toolCalls ?? []) {
      total += tc.name.length + JSON.stringify(tc.arguments ?? {}).length;
    }
  }
  return total;
}

/**
 * Enforces a hard character budget over the conversation by compacting the
 * oldest tool results first (they are re-derivable), then trimming old
 * assistant text. Never drops the system prompt, the original task, or the
 * most recent messages.
 */
export function enforceContextBudget(messages: UnifiedMessage[], maxChars: number): { messages: UnifiedMessage[]; compacted: boolean; chars: number } {
  let chars = estimateMessageChars(messages);
  if (chars <= maxChars) {
    return { messages, compacted: false, chars };
  }
  const out = messages.map((m) => ({ ...m }));
  const systemIdx = out.findIndex((m) => m.role === "system");
  const keepFromEnd = 8;
  let compacted = false;

  for (let i = 0; i < out.length - keepFromEnd && chars > maxChars; i++) {
    const m = out[i];
    if (i === systemIdx) continue;
    if (m.role === "tool" && m.content.length > 120) {
      chars -= m.content.length - 120;
      m.content = "[older tool result compacted by utcode] " + m.content.slice(0, 100);
      compacted = true;
    }
  }
  for (let i = 0; i < out.length - keepFromEnd && chars > maxChars; i++) {
    const m = out[i];
    if (i === systemIdx) continue;
    if (m.role === "assistant" && m.content.length > 400 && (!m.toolCalls || m.toolCalls.length === 0)) {
      chars -= m.content.length - 400;
      m.content = m.content.slice(0, 380) + "\n[... trimmed by utcode ...]";
      compacted = true;
    }
  }
  if (chars > maxChars) {
    for (let i = 0; i < out.length - keepFromEnd && chars > maxChars; i++) {
      const m = out[i];
      if (i === systemIdx) continue;
      if (m.role === "user" && m.content.length > 4000) {
        chars -= m.content.length - 4000;
        m.content = m.content.slice(0, 4000) + "\n[... trimmed by utcode ...]";
        compacted = true;
      }
    }
  }
  return { messages: out, compacted, chars: estimateMessageChars(out) };
}

export function summarizeDependenciesForContext(report: {
  file: string;
  imports: { specifier: string; resolvedPath: string | null }[];
}): string {
  const local = report.imports.filter((i) => i.resolvedPath);
  if (local.length === 0) return "";
  return `Local dependencies of ${report.file}:\n${local.map((i) => `  ${i.specifier} -> ${i.resolvedPath}`).join("\n")}`;
}
