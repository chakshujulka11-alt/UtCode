import { create } from "zustand";
import type { PreviewConsoleLine } from "../../shared/types";

const MAX_LINES = 300;

interface PreviewState {
  lines: PreviewConsoleLine[];
  crashed: string | null;
  pushLine(line: PreviewConsoleLine): void;
  setCrashed(reason: string | null): void;
  clearLines(): void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  lines: [],
  crashed: null,
  pushLine: (line) =>
    set((s) => {
      const next = [...s.lines, line];
      return { lines: next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next };
    }),
  setCrashed: (reason) => set({ crashed: reason }),
  clearLines: () => set({ lines: [] })
}));
