/**
 * Sticky per-run file ownership so parallel agent tasks never edit the same
 * file concurrently. A run that edits a file "owns" it until the run ends.
 */
export interface LockConflict {
  path: string;
  owner: string;
}

class WorkspaceLocks {
  private owners = new Map<string, string>();

  acquire(paths: string[], runId: string): { ok: true } | { ok: false; conflicts: LockConflict[] } {
    const conflicts: LockConflict[] = [];
    for (const p of paths) {
      const owner = this.owners.get(p);
      if (owner && owner !== runId) conflicts.push({ path: p, owner });
    }
    if (conflicts.length > 0) return { ok: false, conflicts };
    for (const p of paths) this.owners.set(p, runId);
    return { ok: true };
  }

  ownerOf(p: string): string | null {
    return this.owners.get(p) ?? null;
  }

  heldBy(runId: string): string[] {
    return [...this.owners.entries()].filter(([, r]) => r === runId).map(([p]) => p);
  }

  release(runId: string): void {
    for (const [p, r] of [...this.owners]) {
      if (r === runId) this.owners.delete(p);
    }
  }

  releaseAll(): void {
    this.owners.clear();
  }
}

export const workspaceLocks = new WorkspaceLocks();
