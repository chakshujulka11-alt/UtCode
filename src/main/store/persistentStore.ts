import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { logger } from "../services/logger";
import type { RecentModel, WindowBounds } from "../../shared/types";

/**
 * PersistentStore — the small slice of app state that was NOT persisted before:
 * window bounds, recently used models, and the last opened workspace.
 * (Providers/settings/chats already persist via settingsStore/chatStore with
 * safeStorage-encrypted keys; this file deliberately does NOT duplicate that.)
 */

export interface PersistentState {
  windowBounds: WindowBounds | null;
  recentModels: RecentModel[];
  lastWorkspace: string | null;
  favorites: string[];
}

const DEFAULTS: PersistentState = {
  windowBounds: null,
  recentModels: [],
  lastWorkspace: null,
  favorites: []
};

const ALLOWED_KEYS: (keyof PersistentState)[] = ["windowBounds", "recentModels", "lastWorkspace", "favorites"];

/** Clamp/validate bounds; returns null when unusable. Pure — unit-tested. */
export function sanitizeWindowBounds(bounds: Partial<WindowBounds> | null | undefined, minW = 900, maxW = 7680): WindowBounds | null {
  if (!bounds || typeof bounds !== "object") return null;
  const width = Math.round(Number(bounds.width));
  const height = Math.round(Number(bounds.height));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < minW || height < 560 || width > maxW || height > 4320) return null;
  const out: WindowBounds = { width, height };
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  if (Number.isFinite(x) && Number.isFinite(y) && x >= -20000 && y >= -20000) {
    out.x = Math.round(x);
    out.y = Math.round(y);
  }
  if (typeof bounds.maximized === "boolean") out.maximized = bounds.maximized;
  return out;
}

/** Is the saved position still on some attached display? Pure — unit-tested. */
export function boundsOnScreen(bounds: WindowBounds, displays: { x: number; y: number; width: number; height: number }[]): boolean {
  if (bounds.x === undefined || bounds.y === undefined) return true;
  return displays.some((d) => bounds.x! >= d.x - 120 && bounds.y! >= d.y - 20 && bounds.x! < d.x + d.width - 60 && bounds.y! < d.y + d.height - 40);
}

class PersistentStore {
  private state: PersistentState = structuredClone(DEFAULTS);
  private file: string | null = null;
  private loaded = false;

  private get filePath(): string {
    if (!this.file) this.file = path.join(app.getPath("userData"), "utcode-state.json");
    return this.file;
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as Partial<PersistentState>;
      this.state = {
        windowBounds: sanitizeWindowBounds(raw.windowBounds ?? null),
        recentModels: Array.isArray(raw.recentModels)
          ? raw.recentModels.filter((m) => m && typeof m.providerId === "string" && typeof m.model === "string").slice(0, 8)
          : [],
        lastWorkspace: typeof raw.lastWorkspace === "string" ? raw.lastWorkspace : null,
        favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((f) => typeof f === "string").slice(0, 40) : []
      };
    } catch {
      /* first run or unreadable — defaults */
    }
  }

  get<K extends keyof PersistentState>(key: K): PersistentState[K] {
    this.load();
    return this.state[key];
  }

  set<K extends keyof PersistentState>(key: K, value: PersistentState[K]): void {
    if (!ALLOWED_KEYS.includes(key)) throw new Error(`Persistent key not allowed: ${String(key)}`);
    this.load();
    this.state[key] = value;
    this.persist();
  }

  /** Push a provider/model to the front of recentModels, dedupe, cap 8. */
  rememberModel(providerId: string, model: string): RecentModel[] {
    const current = this.get("recentModels").filter((m) => !(m.providerId === providerId && m.model === model));
    const next = [{ providerId, model }, ...current].slice(0, 8);
    this.set("recentModels", next);
    return next;
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (err) {
      logger.warn("store", `persist failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const persistentStore = new PersistentStore();
export type PersistentStoreClass = PersistentStore;
