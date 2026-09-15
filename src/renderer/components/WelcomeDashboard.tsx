import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  FolderOpen,
  Lightbulb,
  MessageSquarePlus,
  Monitor,
  PanelLeft,
  SquareTerminal
} from "lucide-react";
import { api, call, clsx } from "../stores/api";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { ChatMessage } from "../../shared/types";
import { UtcodeLogo } from "./UtcodeLogo";

type Tab = "overview" | "models";
type Range = "all" | "30d" | "7d";

const DAY = 24 * 60 * 60 * 1000;

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

interface Stats {
  sessions: number;
  messages: number;
  tokens: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  peakHour: string;
  favoriteModel: string;
}

function computeStats(messages: ChatMessage[]): Stats {
  const perDay = new Map<string, number>();
  const perHour = new Map<number, number>();
  const perModel = new Map<string, number>();
  let chars = 0;
  for (const m of messages) {
    perDay.set(dayKey(m.createdAt), (perDay.get(dayKey(m.createdAt)) ?? 0) + 1);
    perHour.set(new Date(m.createdAt).getHours(), (perHour.get(new Date(m.createdAt).getHours()) ?? 0) + 1);
    chars += m.text.length;
    if (m.role === "assistant" && m.meta) perModel.set(m.meta, (perModel.get(m.meta) ?? 0) + 1);
  }
  let peakHour = "—";
  let peak = 0;
  for (const [h, n] of perHour) {
    if (n > peak) {
      peak = n;
      const ampm = h >= 12 ? "PM" : "AM";
      const hr = h % 12 === 0 ? 12 : h % 12;
      peakHour = `${hr} ${ampm}`;
    }
  }
  let favoriteModel = "—";
  let fav = 0;
  for (const [model, n] of perModel) {
    if (n > fav) {
      fav = n;
      favoriteModel = model;
    }
  }
  const dayKeys = [...perDay.keys()];
  const sorted = [...new Set(dayKeys)].sort((a, b) => {
    const da = a.split("-");
    const db = b.split("-");
    return Date.UTC(+da[0], +da[1], +da[2]) - Date.UTC(+db[0], +db[1], +db[2]);
  });
  let longest = 0;
  let run = 0;
  let prevDayStart: number | null = null;
  for (const k of sorted) {
    const [y, mo, d] = k.split("-").map(Number);
    const t = Date.UTC(y, mo, d);
    run = prevDayStart !== null && t - prevDayStart === DAY ? run + 1 : 1;
    longest = Math.max(longest, run);
    prevDayStart = t;
  }
  let current = 0;
  const today = startOfDay(Date.now());
  for (let i = 0; i < 366; i++) {
    const k = dayKey(today - i * DAY);
    if (perDay.has(k)) current++;
    else if (i > 0) break;
  }
  return {
    sessions: messages.length,
    messages: messages.length,
    tokens: Math.round(chars / 4),
    activeDays: perDay.size,
    currentStreak: current,
    longestStreak: longest,
    peakHour,
    favoriteModel
  };
}

function Heatmap({ messages }: { messages: ChatMessage[] }) {
  const cells = useMemo(() => {
    const perDay = new Map<string, number>();
    for (const m of messages) perDay.set(dayKey(m.createdAt), (perDay.get(dayKey(m.createdAt)) ?? 0) + 1);
    const cols: { date: number; count: number }[][] = [];
    const end = startOfDay(Date.now());
    const total = 7 * 25;
    const start = end - (total - 1) * DAY;
    const startDow = new Date(start).getDay();
    const gridStart = start - startDow * DAY;
    for (let c = 0; c < 25; c++) {
      const col: { date: number; count: number }[] = [];
      for (let r = 0; r < 7; r++) {
        const t = gridStart + (c * 7 + r) * DAY;
        col.push({ date: t, count: perDay.get(dayKey(t)) ?? 0 });
      }
      cols.push(col);
    }
    return cols;
  }, [messages]);

  return (
    <div className="flex gap-[3px] overflow-x-auto pt-1">
      {cells.map((col, ci) => (
        <div key={ci} className="flex flex-col gap-[3px]">
          {col.map((cell) => {
            const level = cell.count === 0 ? 0 : cell.count < 3 ? 1 : cell.count < 8 ? 2 : 3;
            const future = cell.date > startOfDay(Date.now());
            return (
              <div
                key={cell.date}
                title={`${new Date(cell.date).toLocaleDateString()} — ${cell.count} message(s)`}
                className={clsx(
                  "h-[11px] w-[11px] rounded-[2px] transition-all duration-150 hover:z-10 hover:scale-[1.25]",
                  future
                    ? "bg-transparent"
                    : level === 0
                      ? "bg-[#2a2a2a] hover:bg-accent/50"
                      : level === 1
                        ? "bg-[#5b9bd5]/35"
                        : level === 2
                          ? "bg-[#5b9bd5]/65"
                          : "bg-[#5b9bd5]"
                )}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 truncate text-[17px] font-semibold text-white" title={value}>
        {value}
      </div>
    </div>
  );
}

function RangeToggle({ range, setRange }: { range: Range; setRange: (r: Range) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-[#161616] p-0.5">
      {(["all", "30d", "7d"] as Range[]).map((r) => (
        <button
          key={r}
          className={clsx(
            "rounded-md px-2.5 py-1 text-xs",
            range === r ? "bg-panel2 text-white" : "text-muted hover:text-ink"
          )}
          onClick={() => setRange(r)}
        >
          {r === "all" ? "All" : r}
        </button>
      ))}
    </div>
  );
}

export function WelcomeDashboard() {
  const { chats, order, send, newTask } = useChatStore();
  const { providers, settings, patchSettings, selectModel, vectorStats } = useSettingsStore();
  const { openViaDialog, root } = useWorkspaceStore();
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const [user, setUser] = useState("friend");
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<Range>("all");
  const [task, setTask] = useState("");
  const [modelQuery, setModelQuery] = useState("");

  useEffect(() => {
    const customName = settings?.ui.displayName?.trim();
    if (customName) {
      setUser(customName);
      return;
    }
    void call(api.utcode.appInfo()).then((i) => setUser(i.user || "friend")).catch(() => undefined);
  }, [settings?.ui.displayName]);

  const allMessages = useMemo(() => {
    const out: ChatMessage[] = [];
    for (const id of order) for (const m of chats[id]?.messages ?? []) out.push(m);
    return out;
  }, [chats, order]);

  const filtered = useMemo(() => {
    if (range === "all") return allMessages;
    const from = Date.now() - (range === "7d" ? 7 : 30) * DAY;
    return allMessages.filter((m) => m.createdAt >= from);
  }, [allMessages, range]);

  const stats = useMemo(() => {
    const s = computeStats(filtered);
    s.sessions = order.filter((id) => (chats[id]?.messages.length ?? 0) > 0).length;
    return s;
  }, [filtered, order, chats]);

  const temp = settings?.agent.temperature ?? 0.2;
  const tempLabel = temp > 0.5 ? "High" : temp >= 0.25 ? "Medium" : "Low";
  const cycleTemp = (): void => {
    const next = tempLabel === "Low" ? 0.4 : tempLabel === "Medium" ? 0.8 : 0.1;
    void patchSettings({ agent: { ...(settings?.agent ?? { maxIterations: 40, maxOutputPerTool: 28000, maxFileSizeBytes: 1048576, maxSearchResults: 80, maxContextChars: 260000, commandTimeoutMs: 120000, temperature: next, maxTokens: 8192, autoImportScan: true }), temperature: next } });
  };

  const submit = (): void => {
    const t = task.trim();
    if (!t) return;
    setTask("");
    if (!useWorkspaceStore.getState().root) {
      void useChatStore
        .getState()
        .newTask()
        .then((id) => {
          if (id) void useChatStore.getState().send(t);
        });
      return;
    }
    void send(t);
  };

  const enabledProviders = providers.filter((p) => p.enabled);
  const allModels = enabledProviders.flatMap((p) => (p.availableModels ?? [p.model]).map((m) => ({ provider: p, model: m })));
  const mq = modelQuery.trim().toLowerCase();
  const shownModels = mq ? allModels.filter((x) => x.model.toLowerCase().includes(mq) || x.provider.name.toLowerCase().includes(mq)) : allModels.slice(0, 40);
  const activeId = settings?.activeProviderId ?? settings?.defaultProviderId ?? null;

  return (
    <div data-dashboard className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-bg">
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <div className="mx-auto w-full max-w-[880px] px-8 pb-6 pt-10">
          <div className="mb-6 flex items-center gap-3">
            <button className="-ml-1.5 rounded-md p-1.5 text-muted transition-colors duration-200 hover:bg-panel2 hover:text-ink" title="Show explorer sidebar (Ctrl+B)" onClick={toggleSidebar}>
              <PanelLeft className="h-4 w-4" />
            </button>
            <UtcodeLogo size={30} />
            <h1 className="text-[26px] font-semibold tracking-tight text-white">What's up next, {user}?</h1>
          </div>

          <div className="rounded-xl border border-edge bg-panel p-5 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
            <div className="mb-4 flex items-center">
              <div className="flex gap-4">
                <button className={clsx("pb-1 text-sm", tab === "overview" ? "border-b-2 border-accent font-semibold text-white" : "text-muted hover:text-ink")} onClick={() => setTab("overview")}>
                  Overview
                </button>
                <button className={clsx("pb-1 text-sm", tab === "models" ? "border-b-2 border-accent font-semibold text-white" : "text-muted hover:text-ink")} onClick={() => setTab("models")}>
                  Models
                </button>
              </div>
              <div className="ml-auto">
                <RangeToggle range={range} setRange={setRange} />
              </div>
            </div>

            {tab === "overview" ? (
              <>
                <div className="grid grid-cols-4 gap-x-4 gap-y-5">
                  <Stat label="Sessions" value={fmt(stats.sessions)} />
                  <Stat label="Messages" value={fmt(stats.messages)} />
                  <Stat label="Files indexed" value={String(vectorStats?.files ?? 0)} />
                  <Stat label="Active days" value={fmt(stats.activeDays)} />
                  <Stat label="Current streak" value={`${stats.currentStreak}d`} />
                  <Stat label="Longest streak" value={`${stats.longestStreak}d`} />
                  <Stat label="Peak hour" value={stats.peakHour} />
                  <Stat label="Favorite model" value={stats.favoriteModel} />
                </div>
                <div className="mt-5">
                  <Heatmap messages={filtered} />
                </div>
                <div className="mt-3 text-[12px] text-muted">
                  {stats.tokens > 0
                    ? `You've used ~${Math.max(0, Math.round(stats.tokens / 39000)).toLocaleString("en-US")}× more tokens than Animal Farm.`
                    : "No activity yet — run your first task below and this map will light up."}
                </div>
              </>
            ) : (
              <div>
                <input
                  className="input mb-3 max-w-xs font-mono text-xs"
                  placeholder="Search models…"
                  value={modelQuery}
                  onChange={(e) => setModelQuery(e.target.value)}
                />
                {enabledProviders.length === 0 && (
                  <div className="py-6 text-center text-sm text-muted">
                    No providers enabled — open the sidebar (top-left) → <span className="text-ink/80">Settings → Providers</span>.
                  </div>
                )}
                <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                  {shownModels.map((x) => {
                    const isActive = activeId === x.provider.id && x.provider.model === x.model;
                    return (
                      <button
                        key={`${x.provider.id}|${x.model}`}
                        className={clsx(
                          "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs",
                          isActive ? "border-accent/60 bg-accent/10 text-white" : "border-transparent text-ink/80 hover:bg-panel2"
                        )}
                        onClick={() => void selectModel(x.provider.id, x.model)}
                        title={`Use ${x.model} via ${x.provider.name}`}
                      >
                        <span className="shrink-0 font-medium">{x.provider.name}</span>
                        <span className="truncate font-mono text-[11px] text-muted">{x.model}</span>
                        {isActive && <span className="ml-auto shrink-0 text-accent">active</span>}
                      </button>
                    );
                  })}
                  {enabledProviders.length > 0 && shownModels.length === 0 && (
                    <div className="col-span-2 py-4 text-center text-xs text-muted">No model lists fetched yet — use "Fetch models" in Settings.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 mx-auto w-full max-w-[880px] px-8 pb-5">
        <div className="mb-2 flex items-center gap-2">
          <button className="flex items-center gap-2 rounded-full border border-edge bg-panel2 px-3.5 py-1.5 text-xs text-ink transition-colors duration-200 hover:border-accent/50 hover:bg-panel2/70" onClick={() => void openViaDialog()} title="Choose an existing project folder">
            <Monitor className="h-3.5 w-3.5 text-accent" /> Open Folder
          </button>
          <button className="flex items-center gap-2 rounded-full border border-edge bg-panel2 px-3.5 py-1.5 text-xs text-ink hover:border-accent/50" onClick={() => void openViaDialog()} title="Pick or create a project folder (the dialog can create folders)">
            <FolderOpen className="h-3.5 w-3.5 text-accent" /> New folder
          </button>
          <button className="ml-auto flex h-7 w-7 items-center justify-center rounded-md border border-edge bg-[#2a2a2a] text-muted hover:text-ink" title="New chat" onClick={() => void newTask()}>
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-edge bg-panel px-3 py-2.5 focus-within:border-accent/70">
          <input
            className="flex-1 bg-transparent text-sm text-white placeholder:text-muted focus:outline-none"
            placeholder="Describe a task or ask a question"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <span className="text-accent" title="utcode agent · single-tool-calling mode">
            <SquareTerminal className="h-4 w-4" />
          </span>
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-transform hover:bg-accent2 active:scale-95 disabled:opacity-40"
            onClick={submit}
            disabled={!task.trim()}
            title="Start task"
          >
            <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-1.5 flex items-center text-[11px] text-muted">
          <span title="The agent applies edits directly to your files; every change shows in the Diff tab where you can Revert it.">
            Accept edits · auto-applied, reversible in the Diff tab
          </span>
          {!root && (
            <span className="ml-3 flex items-center gap-1.5 rounded-md bg-panel2 px-2 py-1 text-xs text-muted">
              <Lightbulb className="h-3.5 w-3.5 text-accent" /> pick a folder above so the agent can edit files
            </span>
          )}
          <button className="ml-auto flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-0.5 hover:text-ink" onClick={cycleTemp} title="Cycle model temperature: Low · Medium · High">
            {tempLabel}
            <span className={clsx("h-2.5 w-2.5 rounded-full border", tempLabel === "High" ? "border-accent bg-accent" : tempLabel === "Medium" ? "border-accent bg-accent/40" : "border-muted bg-transparent")} />
          </button>
        </div>
      </div>
    </div>
  );
}
