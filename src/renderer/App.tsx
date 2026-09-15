import { useEffect, useRef } from "react";
import { api, call } from "./stores/api";
import type { AgentEvent } from "../shared/types";
import { getAgentLastActivity, touchAgentActivity, useChatStore } from "./stores/chatStore";
import { useEditorStore } from "./stores/editorStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useTerminalStore } from "./stores/terminalStore";
import { usePreviewStore } from "./stores/previewStore";
import { useUiStore } from "./stores/uiStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { Sidebar } from "./components/Sidebar";
import { SidebarRail } from "./components/SidebarRail";
import { Splitter } from "./components/Splitter";
import { ChatView, ChatTabs } from "./components/ChatView";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { StatusBar } from "./components/StatusBar";
import { SettingsModal } from "./components/SettingsModal";
import { WelcomeDashboard } from "./components/WelcomeDashboard";
import { TitleBar } from "./components/TitleBar";
import { ErrorBoundary } from "./components/ErrorBoundary";

window.__utcodeDebug = {
  openFile: (p) => useEditorStore.getState().openFile(p),
  setPanelTab: (t) => useUiStore.getState().setPanelTab(t),
  openWorkspace: async (root) => {
    await call(api.utcode.workspaceOpenPath(root, false));
    useWorkspaceStore.setState({ root, children: {}, expanded: { ".": true } });
    await useWorkspaceStore.getState().refreshDir(".");
  },
  seedChat: async () => {
    const id = window.__utcodeDebug?.seedLocalChat?.("debug session") ?? "";
    return id;
  },
  setSidebar: (open: boolean) => {
    useUiStore.getState().setIsSidebarOpen(open);
    return true;
  },
  newTaskChat: async () => {
    window.__utcodeDebug?.seedLocalChat?.("debug session two");
    return true;
  },
  openChatById: async (id: string) => {
    await useChatStore.getState().openChat(id);
    return true;
  },
  seedLocalChat: (text: string) => {
    const store = useChatStore.getState();
    const id = store.newChat();
    const stamp = Date.now();
    useChatStore.setState((s) => {
      const c = s.chats[id];
      if (!c) return {};
      const messages = [
        { id: `u-${stamp}`, role: "user" as const, text, createdAt: stamp },
        { id: `a-${stamp}`, role: "assistant" as const, text: `utcode ready (local seed for “${text}”)`, createdAt: stamp + 1, toolEvents: [] }
      ];
      return { chats: { ...s.chats, [id]: { ...c, messages, title: text, updatedAt: stamp } }, order: s.order.includes(id) ? s.order : [id, ...s.order] };
    });
    return id;
  },
  chatIds: () => {
    const s = useChatStore.getState();
    return s.order.filter((id) => (s.chats[id]?.messages.length ?? 0) > 0);
  },
  deleteChatById: (id: string) => {
    void useChatStore.getState().deleteChat(id);
    return true;
  },
  snapshot: () => {
    const s = useChatStore.getState();
    return JSON.stringify({
      n: s.order.filter((id) => (s.chats[id]?.messages.length ?? 0) > 0).length,
      running: s.running,
      runningIds: Object.keys(s.runningChats),
      activeId: s.activeId,
      activeHasMessages: s.activeId ? (s.chats[s.activeId]?.messages.length ?? 0) > 0 : false,
      chatRoot: s.activeId ? s.chats[s.activeId]?.workspaceRoot ?? null : null,
      openTabs: s.activeId ? s.chats[s.activeId]?.openFiles?.length ?? 0 : useEditorStore.getState().tabs.length,
      dash: !!document.querySelector("[data-dashboard]")
    });
  }
};

export default function App() {
  const { isSidebarOpen, rightOpen, workspaceWidth, windowWidth, toggleSidebar, toggleRight, setSettingsOpen, setWindowWidth } = useUiStore();
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const hasMessages = useChatStore((s) => s.order.some((id) => (s.chats[id]?.messages.length ?? 0) > 0));
  const activeEmpty = useChatStore((s) => (s.activeId ? (s.chats[s.activeId]?.messages.length ?? 0) === 0 : true));
  const showDashboard = activeEmpty;
  void hasMessages;
  const narrow = windowWidth > 0 && windowWidth < 1000;
  const sidebarW = useUiStore((s) => s.sidebarWidth);
  // Only let the sidebar occupy layout width when the window is wide enough to hold
  // sidebar(240) + chat(min 360) + workspace(min 350); below that, the icon rail is used.
  const sidebarShown = isSidebarOpen && !narrow;
  const closedBase = narrow ? 58 : 8;
  const reserved = (sidebarShown ? sidebarW + 6 : closedBase) + 360 + 18;
  const effectiveRight = Math.max(350, Math.min(workspaceWidth, (windowWidth || 1440) - reserved));
  const prevNarrow = useRef(narrow);

  useEffect(() => {
    const onResize = (): void => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setWindowWidth]);

  useEffect(() => {
    if (narrow && !prevNarrow.current) {
      const s = useUiStore.getState();
      if (s.isSidebarOpen) s.toggleSidebar();
    }
    prevNarrow.current = narrow;
  }, [narrow]);

  useEffect(() => {
    void (async () => {
      await useSettingsStore.getState().init();
      const ui = useSettingsStore.getState().settings?.ui;
      if (ui) useUiStore.getState().applyLayout(ui);
      await useWorkspaceStore.getState().init();
      await useChatStore.getState().init();
      if (useChatStore.getState().activeId === null) {
        useChatStore.getState().newChat();
      }
    })();
  }, []);

  useEffect(() => {
    const offAgent = api.utcode.onAgentEvent((event: AgentEvent) => {
      if (event.kind === "index" || event.runId === "indexer") {
        useSettingsStore.getState().handleIndexEvent(event as unknown as { status?: string; done?: number; total?: number });
        return;
      }
      if (event.kind === "file_changed" && event.path) {
        // Loop guard: while an agent is running, ignore EXTERNAL disk churn
        // (the main-process watcher already suppresses it; this is the second
        // half). The agent's own write/patch/* nudges still refresh the tree.
        const agentBusy = Object.keys(useChatStore.getState().runningChats).length > 0;
        const external = event.runId === "external";
        if (!(agentBusy && external)) {
          useUiStore.getState().bumpPreview();
          void useWorkspaceStore.getState().revealPath(event.path);
        }
      }
      useChatStore.getState().handleEvent(event);
      if (event.kind === "terminal_output" || event.kind === "terminal_finished") {
        void useEditorStore.getState().refreshAfterExternalChange();
      }
    });
    const offTerminal = api.utcode.onTerminalStream((chunk) => {
      useTerminalStore.getState().onChunk(chunk);
      touchAgentActivity();
      if (chunk.stream === "system" && /Exit code/.test(chunk.data)) {
        void useEditorStore.getState().refreshAfterExternalChange();
      }
    });
    const offPConsole = api.utcode.onPreviewConsole((line) => usePreviewStore.getState().pushLine(line));
    const offPCrash = api.utcode.onPreviewCrashed((info) => usePreviewStore.getState().setCrashed(info?.reason || "crashed"));
    const watchdog = window.setInterval(() => {
      const chat = useChatStore.getState();
      if (chat.running && Date.now() - getAgentLastActivity() > 6 * 60 * 1000) {
        void chat.stop();
        useUiStore.getState().toastMessage("Agent produced no activity for 6 minutes — task marked stopped. Try again.", "error");
      }
    }, 15000);
    return () => {
      offAgent();
      offTerminal();
      offPConsole();
      offPCrash();
      window.clearInterval(watchdog);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(!settingsOpen);
      } else if (mod && e.key.toLowerCase() === "b" && !e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleRight();
      } else if (mod && e.key === "`") {
        e.preventDefault();
        useUiStore.getState().setPanelTab("terminal");
      } else if (e.key === "Escape" && useChatStore.getState().running) {
        void useChatStore.getState().stop();
      } else if (mod && e.key.toLowerCase() === "s" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        void useEditorStore.getState().saveActive();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, setSettingsOpen, toggleSidebar, toggleRight]);

  return (
    <ErrorBoundary>
      <div className="relative flex h-full flex-col overflow-hidden">
        <TitleBar />
        <div className="relative flex min-h-0 flex-1">
          {isSidebarOpen && narrow && (
            <button aria-label="Close sidebar" className="absolute inset-0 z-20 cursor-default bg-black/30 backdrop-blur-[2px]" onClick={toggleSidebar} />
          )}
          <div
            className={
              narrow
                ? "absolute inset-y-0 left-0 z-30 flex overflow-hidden shadow-[10px_0_40px_rgba(0,0,0,0.55)] transition-[width] duration-300 ease-in-out"
                : "flex shrink-0 overflow-hidden transition-all duration-300 ease-in-out"
            }
            style={{ width: sidebarShown || (isSidebarOpen && narrow) ? sidebarW + (narrow ? 0 : 6) : 0 }}
            aria-hidden={!isSidebarOpen}
          >
            <Sidebar />
            {!narrow && (
              <Splitter
                title="Drag to resize explorer · double-click to reset"
                getValue={() => useUiStore.getState().sidebarWidth}
                onChange={(v) => useUiStore.getState().setSidebarWidth(v)}
                onCommit={() => useUiStore.getState().persistLayout()}
                onReset={() => useUiStore.getState().resetSidebarWidth()}
              />
            )}
          </div>
          {!isSidebarOpen && narrow && <SidebarRail />}
          <div className="flex min-w-0 flex-1 flex-col">
            <ChatTabs />
            <div className="flex min-h-0 flex-1">
              {showDashboard ? (
                <WelcomeDashboard />
              ) : (
                <>
                  <div className="min-w-[360px] flex-1 overflow-hidden"><ChatView /></div>
                  {rightOpen && (
                    <>
                      <Splitter
                        invert
                        title="Drag to resize workspace panel · double-click to reset"
                        getValue={() => useUiStore.getState().workspaceWidth}
                        onChange={(v) => useUiStore.getState().setWorkspaceWidth(v)}
                        onCommit={() => useUiStore.getState().persistLayout()}
                        onReset={() => useUiStore.getState().resetWorkspaceWidth()}
                      />
                      <div className="min-w-[350px] shrink-0 overflow-hidden" style={{ width: effectiveRight }}>
                        <WorkspacePanel />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <StatusBar />
        <SettingsModal />
      </div>
    </ErrorBoundary>
  );
}
