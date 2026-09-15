import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { CHATS_FILE, MAX_CHATS_PERSISTED } from "../../shared/constants";
import type { Chat } from "../../shared/types";
import { logger } from "./logger";

class ChatStore {
  private chats: Chat[] | null = null;

  private get filePath(): string {
    return path.join(app.getPath("userData"), CHATS_FILE);
  }

  load(): Chat[] {
    if (this.chats) return this.chats;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as Chat[];
        this.chats = Array.isArray(raw) ? raw : [];
      } else {
        this.chats = [];
      }
    } catch (err) {
      logger.error("chats", `Failed to load chats: ${err instanceof Error ? err.message : String(err)}`);
      this.chats = [];
    }
    return this.chats;
  }

  list(): Chat[] {
    return this.load().map((c) => ({ ...c, messages: c.messages.slice(-80) }));
  }

  save(chat: Chat): Chat[] {
    const chats = this.load();
    const trimmed: Chat = {
      ...chat,
      messages: chat.messages.slice(-120).map((m) => ({
        ...m,
        streaming: false,
        toolEvents: (m.toolEvents ?? []).slice(-200)
      }))
    };
    const idx = chats.findIndex((c) => c.id === chat.id);
    if (idx >= 0) chats[idx] = trimmed;
    else chats.unshift(trimmed);
    this.chats = chats
      .filter((c) => c.messages.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CHATS_PERSISTED);
    this.persist();
    return this.list();
  }

  delete(id: string): Chat[] {
    this.chats = this.load().filter((c) => c.id !== id);
    this.persist();
    return this.list();
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.chats ?? []), "utf-8");
    } catch (err) {
      logger.error("chats", `Failed to persist chats: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const chatStore = new ChatStore();
