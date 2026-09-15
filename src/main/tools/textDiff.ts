export interface LineDiff {
  added: number;
  removed: number;
  hunks: { oldStart: number; newStart: number; lines: string[] }[];
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function extractLineDiff(before: string, after: string): LineDiff {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const removed = endA - start;
  const added = endB - start;
  const lines: string[] = [];
  for (let i = start; i < endA; i++) lines.push(`-${a[i]}`);
  for (let i = start; i < endB; i++) lines.push(`+${b[i]}`);
  return {
    added,
    removed,
    hunks: lines.length ? [{ oldStart: start + 1, newStart: start + 1, lines: lines.slice(0, 400) }] : []
  };
}

export function diffSummary(before: string, after: string): string {
  const d = extractLineDiff(before, after);
  return `+${d.added} -${d.removed}`;
}
