/// <reference types="vite/client" />
import type { UtcodeApi } from "../shared/ipc";

declare global {
  interface Window {
    utcode: UtcodeApi;
    __utcodeDebug?: {
      openFile(path: string): Promise<void>;
      setPanelTab(tab: "code" | "diff" | "preview" | "terminal"): void;
      openWorkspace(root: string): Promise<void>;
      seedChat(): Promise<string>;
      seedLocalChat(text: string): string;
      openChatById(id: string): Promise<boolean>;
      setSidebar(open: boolean): boolean;
      newTaskChat(): Promise<boolean>;
      chatIds(): string[];
      deleteChatById(id: string): boolean;
      snapshot(): string;
    };
  }
}

export {};
