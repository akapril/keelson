import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../store/settings";
import type { AiProvider } from "../types/ai";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExportSection } from "@/features/export/ExportSection";
import { UpdateSection } from "@/features/updater/UpdateSection";
import { BackendSection } from "@/features/backend/BackendSection";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";
import { on } from "@/lib/tauri/events";
import {
  newSessionsPref,
  setNewSessionsPref,
} from "@/features/notifications/new-sessions";
import { NOTIF_TYPES, useNotifPrefsStore } from "@/store/notification-prefs";
import { DEFAULT_EMBED_CONFIG } from "@/types/rag";
import type { EmbedConfig } from "@/types/rag";
import {
  WORKSPACE_TABS,
  getDefaultTab,
  setDefaultTab,
  type WorkspaceTab,
} from "@/features/board/project-tab-pref";
import {
  getAutoArchiveDays,
  setAutoArchiveDays,
} from "@/features/board/task-archive";
import {
  getAutoSyncTasks,
  setAutoSyncTasks,
} from "@/features/board/auto-sync-pref";
import {
  getAutoStartRuntime,
  setAutoStartRuntime,
} from "@/features/board/runtime-daemon";
import type { RuntimeDiag } from "@/types/runtime";

// ── 快捷键字符串构建辅助 ───────────────────────────────────────
/**
 * 从 KeyboardEvent 构建形如 "CommandOrControl+Shift+Space" 的快捷键字符串。
 * 遵循 tauri_plugin_global_shortcut 期望的格式。
 */
function buildHotkeyString(e: KeyboardEvent): string {
  const parts: string[] = [];

  // 修饰键（按固定顺序，避免 "Shift+Ctrl" vs "Ctrl+Shift" 歧义）
  if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  // 主键（排除纯修饰键按下）
  const MODIFIER_KEYS = new Set([
    "Control", "Meta", "Alt", "Shift",
    "CapsLock", "NumLock", "ScrollLock",
  ]);
  if (!MODIFIER_KEYS.has(e.key)) {
    // 将浏览器 key 名称标准化为 Tauri 期望格式
    const key = normalizeKey(e.key, e.code);
    parts.push(key);
  }

  return parts.join("+");
}

/**
 * 将浏览器 KeyboardEvent.key 标准化为 Tauri 快捷键格式。
 * 参考：https://docs.rs/global-hotkey/latest/global_hotkey/hotkey/enum.Code.html
 */
function normalizeKey(key: string, code: string): string {
  // 功能键直接使用
  if (/^F\d+$/.test(key)) return key;
  // 空格
  if (key === " " || key === "Spacebar") return "Space";
  // 方向键
  const arrowMap: Record<string, string> = {
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  };
  if (key in arrowMap) return arrowMap[key];
  // 单字符：数字和字母直接大写
  if (key.length === 1) return key.toUpperCase();
  // 其余（Escape、Enter、Tab、Backspace 等）直接透传
  // 对于 code 中的 Key* / Digit* 作为兜底
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return key;
}

// ── 快捷键捕获控件 ────────────────────────────────────────────
interface HotkeyCaptureProps {
  value: string;
  onCapture: (hotkey: string) => void;
  disabled?: boolean;
}

function HotkeyCapture({ value, onCapture, disabled }: HotkeyCaptureProps) {
  // 是否处于"捕获中"状态
  const [capturing, setCapturing] = useState(false);
  // 捕获中显示的预览字符串
  const [preview, setPreview] = useState("");
  const divRef = useRef<HTMLDivElement>(null);

  // 进入捕获模式：聚焦 div 并重置预览
  function startCapture() {
    if (disabled) return;
    setCapturing(true);
    setPreview("");
    divRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();

    // Escape 取消捕获
    if (e.key === "Escape") {
      setCapturing(false);
      setPreview("");
      return;
    }

    const combo = buildHotkeyString(e.nativeEvent);
    setPreview(combo);

    // 只有包含非修饰键时才视为完整组合，触发回调
    const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift"]);
    if (!MODIFIER_KEYS.has(e.key) && combo.includes("+")) {
      setCapturing(false);
      onCapture(combo);
    }
  }

  function handleBlur() {
    // 失焦时退出捕获模式
    setCapturing(false);
    setPreview("");
  }

  // 显示文本：捕获中 → 预览；否则 → 当前值（或提示）
  const displayText = capturing
    ? preview || "按下快捷键组合…"
    : value || "点击以设置";

  return (
    <div
      ref={divRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={`快捷键输入，当前：${value || "未设置"}`}
      aria-disabled={disabled}
      onMouseDown={startCapture}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      className={[
        "inline-flex min-w-48 cursor-pointer select-none items-center",
        "rounded-md border px-3 py-1.5 font-mono text-sm",
        "transition-colors focus:outline-none",
        capturing
          ? "border-ring bg-accent text-accent-foreground ring-2 ring-ring"
          : "border-border bg-muted text-foreground hover:bg-accent hover:text-accent-foreground",
        disabled ? "pointer-events-none opacity-50" : "",
      ].join(" ")}
    >
      {displayText}
    </div>
  );
}

// ── 设置页面主体 ───────────────────────────────────────────────
/**
 * 设置页面。
 *
 * 功能：
 * 1. 全局唤起快捷键 — 通过 HotkeyCapture 控件捕获，经 useSettingsStore.saveHotkey
 *    调用 ipc.setHotkey 持久化，并在 Rust 端立即重新注册（Task 21）。
 * 2. 工作区路径 — 本地状态编辑，MVP 阶段前端维护（useSettingsStore.workspacePath
 *    暂不持久化到后端，符合 Task 17 设计）。
 *
 * 颜色全部使用 Tailwind 语义类（无硬编码 hex/rgba），自动适配明暗主题。
 */

/**
 * MCP 接入区：让本地 claude / codex 通过 rework 内置 MCP server 操作看板与文档。
 * 一键把 rework 写入客户端配置（~/.claude.json / ~/.codex/config.toml），无需手动 claude mcp add。
 */
function McpSection() {
  const [endpoint, setEndpoint] = useState<{ url: string; secret: string } | null>(null);
  const [busy, setBusy] = useState<"claude" | "codex" | null>(null);

  useEffect(() => {
    void ipc
      .mcpEndpoint()
      .then(setEndpoint)
      .catch(() => setEndpoint(null));
  }, []);

  const install = async (target: "claude" | "codex") => {
    setBusy(target);
    try {
      const msg =
        target === "claude"
          ? await ipc.mcpInstallClaude()
          : await ipc.mcpInstallCodex();
      toast.success(msg);
    } catch (e) {
      toast.error(`接入失败：${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">MCP 接入（claude / codex）</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          让本地 claude / codex 直接操作你的看板任务与文档。一键写入客户端配置，无需手动命令。
          需重启客户端会话生效。
        </p>
      </div>

      {endpoint ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          端点：<span className="font-mono text-foreground">{endpoint.url}</span>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          MCP 端点未就绪（应用可能刚启动，稍后重进设置页）。
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!endpoint || busy !== null}
          onClick={() => void install("claude")}
        >
          {busy === "claude" ? "接入中…" : "接入 Claude Code"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!endpoint || busy !== null}
          onClick={() => void install("codex")}
        >
          {busy === "codex" ? "接入中…" : "接入 Codex"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        提示：secret 已持久化，端口固定 47600，接入一次长期有效（除非端口被占用回退）。
        仅本机（127.0.0.1）；需 rework 应用开着。
      </p>
    </section>
  );
}

/**
 * 实时活动 hook 区（Phase 2）：一键在 ~/.claude/settings.json 装/卸 rework 的 PostToolUse
 * 转发条目，让 Claude Code 的全量工具流（Edit/Write/Bash/Read/…）实时出现在 rework 活动流。
 * 仿溯源 HookBar：装/卸/状态 + toast。只增删 rework 自己那一条，用户其它 hooks/设置不动。
 */
function ActivityHookSection() {
  // null=读取中；否则 { installed, up_to_date }
  const [status, setStatus] = useState<{ installed: boolean; up_to_date: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void ipc
      .activityHookStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  };
  useEffect(refresh, []);

  // 安装/升级都调 install（幂等，就地替换成当前版本命令）
  const install = async (isUpgrade: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await ipc.installActivityHook();
      toast.success(
        isUpgrade
          ? "hook 已升级到最新版本（需重启 Claude 会话生效）"
          : "已启用：Claude Code 的工具操作将实时上报（需重启会话生效）",
      );
      refresh();
    } catch (e) {
      toast.error(`操作失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const uninstall = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ipc.uninstallActivityHook();
      toast.success("已停用实时活动 hook");
      refresh();
    } catch (e) {
      toast.error(`操作失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const installed = status?.installed ?? false;
  const stale = installed && !status?.up_to_date; // 装了但过期，需升级

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">实时活动 hook（Claude Code）</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          启用后，Claude Code 每次工具操作（编辑/写入/执行/读取…）都会实时上报到 rework 活动流。
          仅改动 ~/.claude/settings.json 里 rework 自己那一条，其它设置逐字保留。需重启会话生效。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {status === null ? (
          <span className="text-xs text-muted-foreground">读取状态中…</span>
        ) : stale ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            已启用（有更新，建议升级）
          </span>
        ) : installed ? (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            实时活动 hook 已启用（最新）
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">未启用</span>
        )}

        {/* 过期 → 升级；否则 启用/停用 */}
        {stale && (
          <Button variant="default" size="sm" disabled={busy} onClick={() => void install(true)}>
            {busy ? "处理中…" : "一键升级 hook"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={status === null || busy}
          onClick={() => void (installed ? uninstall() : install(false))}
        >
          {busy ? "处理中…" : installed ? "停用" : "启用实时活动 hook"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        说明：Codex 无逐工具 hook，仅通过 MCP（上方）上报看板/文档操作；实时全量工具流仅 Claude Code 支持。
        {stale && " · 检测到已装的是旧版命令，点「升级」就地替换（不影响你其它 hook）。"}
      </p>
    </section>
  );
}

/**
 * 通知偏好区：逐类型开关（铃铛 + 桌面两渠道），可独立关闭任意来源。
 * 关闭后：前端不再写入该类型通知（创建侧 gate），铃铛/收件箱也不显示（展示侧 gate）。
 * 「发现新会话」有独立的旧偏好开关，保留向后兼容并在此一同展示。
 */
function NotifyPrefsSection() {
  // 旧的会话摘要开关（独立 localStorage key）
  const [newSessions, setNewSessions] = useState(newSessionsPref());
  const toggleNewSessions = (v: boolean) => {
    setNewSessions(v);
    setNewSessionsPref(v);
  };

  // 新的逐类型偏好 store
  const prefs = useNotifPrefsStore((s) => s.prefs);
  const setEnabled = useNotifPrefsStore((s) => s.setEnabled);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">通知偏好</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          控制哪些类型的通知写入铃铛/收件箱，以及是否弹出桌面系统通知。
          关闭后，该类型既不创建也不显示（含外部 Agent 写入的同类型通知）。
        </p>
      </div>

      {/* 逐类型开关 */}
      <div className="space-y-2">
        {NOTIF_TYPES.map(({ source, label }) => {
          const enabled = prefs[source] !== false;
          return (
            <label
              key={source}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent/40"
            >
              <span className="select-none">{label}</span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(source, e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 accent-primary"
              />
            </label>
          );
        })}
      </div>

      {/* 旧：会话摘要粒度控制（启动时是否推摘要条；与"会话"类型开关叠加） */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">会话提醒细粒度</p>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={newSessions}
            onChange={(e) => toggleNewSessions(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input accent-primary"
          />
          <span>发现新的本地 CLI 会话时提醒（启动时汇总一条，需「会话」类型也开启才生效）</span>
        </label>
      </div>
    </section>
  );
}

/**
 * 项目默认打开标签页：设全局兜底默认。打开项目时优先级为
 * 深链 ?tab= > 该项目上次停留(自动记住) > 此处全局默认。纯本地偏好，无后端。
 */
function ProjectDefaultTabSection() {
  const [tab, setTab] = useState<WorkspaceTab>(() => getDefaultTab());
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">项目默认打开标签页</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          打开一个项目时默认停留的标签页。系统会自动记住每个项目上次停留的位置并优先回到那里；
          此处仅作为「从未打开过」时的兜底默认。
        </p>
      </div>
      <Select
        value={tab}
        onValueChange={(v) => {
          const next = v as WorkspaceTab;
          setTab(next);
          setDefaultTab(next);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="选择默认标签页" />
        </SelectTrigger>
        <SelectContent>
          {WORKSPACE_TABS.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}

/**
 * 看板已完成任务自动归档阈值：完成超过 N 天的任务在打开项目时自动归档（保留溯源，不删除）。
 * 0 = 关闭自动归档（仍可手动归档）。纯本地偏好。
 */
const AUTO_ARCHIVE_OPTIONS = [
  { value: "0", label: "关闭（仅手动归档）" },
  { value: "3", label: "完成 3 天后" },
  { value: "7", label: "完成 7 天后" },
  { value: "14", label: "完成 14 天后" },
  { value: "30", label: "完成 30 天后" },
];
function AutoArchiveSection() {
  const [days, setDays] = useState<string>(() => String(getAutoArchiveDays()));
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">看板已完成任务自动归档</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          打开项目时，把「完成」列中停留超过所选天数的任务自动归档（软删除、保留会话/提交溯源，
          默认从看板隐藏，可随时「显示归档」查看或取消归档）。不会删除任何数据。
        </p>
      </div>
      <Select
        value={days}
        onValueChange={(v) => {
          setDays(v);
          setAutoArchiveDays(Number(v));
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="选择自动归档时机" />
        </SelectTrigger>
        <SelectContent>
          {AUTO_ARCHIVE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}

/**
 * 看板自动同步开关：Claude 会话的 TaskCreate/TaskUpdate 经活动 hook 到达时，
 * 是否自动同步进匹配项目的看板。关掉后只保留会话预览的手动「同步任务」按钮。纯本地偏好。
 */
function AutoSyncTasksSection() {
  const [on, setOn] = useState<boolean>(() => getAutoSyncTasks());
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">看板自动同步（CLI 任务）</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          开启后，Claude 会话里建/改任务（TaskCreate/TaskUpdate）会实时同步进其关联项目的看板。
          关掉则不自动同步，仍可在会话预览手动点「同步任务」。依赖上方「实时活动 hook」已启用。
        </p>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            setAutoSyncTasks(e.target.checked);
          }}
          className="size-4 cursor-pointer rounded border-input accent-primary"
        />
        <span>自动同步 CLI 任务到看板</span>
      </label>
    </section>
  );
}

/**
 * claude-runtime 运行时区：融入的进程管理器（daemon）的自检 / 自动启动 / 修复入口。
 * 「进程」tab 依赖 daemon 在 :19191 运行；此处集中管理其生命周期，让「未运行」基本不再出现。
 * 自动启动为纯本地偏好（默认开），App 启动时按此拉起；「立即修复」手动补救。
 */
function RuntimeSection() {
  // null=尚未体检；否则为最近一次 diagnose 结果
  const [diag, setDiag] = useState<RuntimeDiag | null>(null);
  const [checking, setChecking] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [autoStart, setAutoStartState] = useState<boolean>(() => getAutoStartRuntime());

  // 拉取一次体检结果
  const check = async () => {
    setChecking(true);
    try {
      setDiag(await ipc.runtimeDiagnose());
    } catch {
      setDiag(null);
    } finally {
      setChecking(false);
    }
  };
  // 挂载时体检一次
  useEffect(() => {
    void check();
  }, []);

  // 立即修复：确保 daemon 运行，再复检
  const fix = async () => {
    setFixing(true);
    try {
      const up = await ipc.runtimeEnsureDaemon();
      toast[up ? "success" : "error"](
        up ? "claude-runtime daemon 已就绪" : "拉起后仍未连通，请查看是否已安装二进制",
      );
      await check();
    } catch (e) {
      toast.error(`修复失败：${String(e)}`);
    } finally {
      setFixing(false);
    }
  };

  const toggleAuto = (on: boolean) => {
    setAutoStartState(on);
    setAutoStartRuntime(on);
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">运行时（claude-runtime）</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          融入的进程管理器。项目「进程」标签依赖它的 daemon 在后台运行。开启自动启动后，
          rework 启动时会静默拉起 daemon（幂等安全），「未运行」基本不再出现。
        </p>
      </div>

      {/* 自动启动开关 */}
      <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
        <input
          type="checkbox"
          checked={autoStart}
          onChange={(e) => toggleAuto(e.target.checked)}
          className="size-4 cursor-pointer rounded border-input accent-primary"
        />
        <span>随 rework 自动启动 daemon</span>
      </label>

      {/* 体检状态 */}
      <div className="space-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
        {diag === null ? (
          <span className="text-muted-foreground">{checking ? "体检中…" : "未体检"}</span>
        ) : !diag.binary_found ? (
          <div className="space-y-1 text-amber-600 dark:text-amber-400">
            <div>未检测到 claude-runtime 二进制（不在 PATH 中）。</div>
            <div className="text-muted-foreground">
              安装后即可使用：
              <code className="ml-1 rounded bg-muted px-1 text-foreground">
                cargo install --path D:\workspace\claude-runtime\crates\cli
              </code>
            </div>
          </div>
        ) : (
          <>
            <StatusRow ok label="二进制" value={diag.version || diag.binary_path || "已安装"} />
            <StatusRow
              ok={diag.daemon_running}
              label="daemon (:19191)"
              value={diag.daemon_running ? "运行中" : "未运行"}
            />
            <StatusRow
              ok={diag.dashboard_reachable}
              label="Dashboard (:19192)"
              value={diag.dashboard_reachable ? "可访问" : "未就绪"}
            />
          </>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={checking} onClick={() => void check()}>
          {checking ? "体检中…" : "自检"}
        </Button>
        {diag && diag.binary_found && !diag.daemon_running && (
          <Button variant="default" size="sm" disabled={fixing} onClick={() => void fix()}>
            {fixing ? "启动中…" : "立即修复（启动 daemon）"}
          </Button>
        )}
        {diag?.dashboard_reachable && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void ipc.runtimeOpenDashboard().catch(() => {})}
          >
            打开 Dashboard
          </Button>
        )}
      </div>
    </section>
  );
}

/** 体检状态一行：绿点/灰点 + 标签 + 值。 */
function StatusRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={
          "size-2 shrink-0 rounded-full " + (ok ? "bg-green-500" : "bg-muted-foreground/40")
        }
      />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto truncate font-mono text-foreground">{value}</span>
    </div>
  );
}

export default function Settings() {
  const { hotkey, workspacePath, loading, error, load, saveHotkey } =
    useSettingsStore();

  // AI 助手配置（受控，来源于 store，写入即持久化 localStorage）
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const setAiConfig = useSettingsStore((s) => s.setAiConfig);

  // 模型列表（可选：从服务商 /models 接口拉取，作为输入建议；拉不到则纯手填）
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // 切换服务商时清空上一个商的模型建议，避免张冠李戴
  useEffect(() => {
    setModels([]);
  }, [aiConfig.provider]);

  // 拉取当前服务商的可用模型；成功给下拉建议，失败/为空提示手动输入
  const fetchModels = async () => {
    if (modelsLoading) return;
    setModelsLoading(true);
    try {
      const list = await ipc.listModels(aiConfig);
      setModels(list);
      toast[list.length ? "success" : "message"](
        list.length ? `获取到 ${list.length} 个模型` : "未获取到模型列表，请手动输入",
      );
    } catch (e) {
      setModels([]);
      toast.error(`拉取模型失败，请手动输入：${e instanceof Error ? e.message : e}`);
    } finally {
      setModelsLoading(false);
    }
  };

  // 本地工作区路径编辑状态（不直接写 store 的 workspacePath 避免频繁触发渲染）
  const [localPath, setLocalPath] = useState(workspacePath);

  // 检索 / 嵌入配置（与 AskPane 共享同一 localStorage key：rework-embed-config）
  const [embedCfg, setEmbedCfgState] = useState<EmbedConfig>(() => {
    try {
      const raw = localStorage.getItem("rework-embed-config");
      return { ...DEFAULT_EMBED_CONFIG, ...(raw ? JSON.parse(raw) : {}) };
    } catch {
      return { ...DEFAULT_EMBED_CONFIG };
    }
  });

  // 「重建索引」加载状态 + 进度(会话数，0/结束为 null)
  const [rebuilding, setRebuilding] = useState(false);
  const [indexProgress, setIndexProgress] = useState<number | null>(null);
  // 上次成功建索引时的 embed 标识（provider:model），用于提示"配置已变，请重建"
  const [lastIndexedModel, setLastIndexedModel] = useState<string>(
    () => localStorage.getItem("rework-rag-indexed-model") ?? "",
  );

  // 监听后端索引进度事件（rag_build_index emit）
  useEffect(() => {
    const p = on<number>("rag-index-progress", (n) => setIndexProgress(n > 0 ? n : null));
    return () => {
      void p.then((un) => un());
    };
  }, []);

  /**
   * 更新嵌入配置。按嵌入服务商隔离各自字段，切换服务商互不覆盖：
   * - rework-embed-config 保存「当前激活」的扁平配置（AskPane 读这份，结构不变）；
   * - rework-embed-by-provider 保存每个服务商各自的 {base_url,api_key,model} 快照。
   */
  function setEmbed(patch: Partial<EmbedConfig>) {
    type EmbedFields = Omit<EmbedConfig, "provider">;
    const MAP_KEY = "rework-embed-by-provider";
    const loadMap = (): Record<string, EmbedFields> => {
      try {
        const raw = localStorage.getItem(MAP_KEY);
        return raw ? (JSON.parse(raw) as Record<string, EmbedFields>) : {};
      } catch {
        return {};
      }
    };
    setEmbedCfgState((prev) => {
      const map = loadMap();
      // 先把当前服务商字段快照进 map（不含 provider）
      map[prev.provider] = { base_url: prev.base_url, api_key: prev.api_key, model: prev.model };

      let next: EmbedConfig;
      if (patch.provider && patch.provider !== prev.provider) {
        // 切换服务商：取目标商已存字段，缺省用默认（模型预填默认，key/url 留空）
        const f = map[patch.provider] ?? {
          base_url: "",
          api_key: "",
          model: DEFAULT_EMBED_CONFIG.model,
        };
        next = { provider: patch.provider, ...f };
      } else {
        // 同一服务商内改字段：更新当前商的快照
        next = { ...prev, ...patch };
        map[next.provider] = { base_url: next.base_url, api_key: next.api_key, model: next.model };
      }
      try {
        localStorage.setItem("rework-embed-config", JSON.stringify(next)); // AskPane 读的扁平当前值
        localStorage.setItem(MAP_KEY, JSON.stringify(map));
      } catch {
        // 忽略 localStorage 写入失败（如隐私模式）
      }
      return next;
    });
  }

  // 当前嵌入标识 + 索引是否可能过期（已建过、但 provider/model 变了）
  const embedModelId = `${embedCfg.provider}:${embedCfg.model}`;
  const indexStale = !!lastIndexedModel && lastIndexedModel !== embedModelId;
  // AI 对话是否为「OpenAI 兼容 + 有 key」，可复用其密钥做 embeddings
  const aiReusable = aiConfig.provider === "openai" && !!aiConfig.api_key;

  /** 一键复用 AI 对话的 OpenAI 密钥做 embeddings（切到 api 并填 base_url/key/model） */
  const reuseAiKey = () => {
    if (!aiReusable) return;
    setEmbed({ provider: "api" }); // 先切 provider（其字段隔离逻辑会先加载 api 快照）
    setEmbed({
      base_url: aiConfig.base_url,
      api_key: aiConfig.api_key,
      model: "text-embedding-3-small",
    });
    toast.success("已复用 AI 对话的 OpenAI 密钥（可点「重建索引」启用语义）");
  };

  /** 调用后端重建全量嵌入索引 */
  const rebuildIndex = async () => {
    setRebuilding(true);
    try {
      const n = await ipc.ragBuildIndex(embedCfg);
      if (n === 0) {
        toast(`暂无会话可索引（可能扫描未完成）`);
      } else {
        toast.success(`索引完成：${n} 个片段`);
        // 记录本次索引的 embed 标识，供"过期"提示比对
        localStorage.setItem("rework-rag-indexed-model", embedModelId);
        setLastIndexedModel(embedModelId);
      }
    } catch (e) {
      toast.error(`索引失败：${String(e)}`);
    } finally {
      setRebuilding(false);
      setIndexProgress(null);
    }
  };

  // 挂载时从后端加载设置
  useEffect(() => {
    load();
  }, [load]);

  // 当 store 中的 workspacePath 更新时同步本地状态
  useEffect(() => {
    setLocalPath(workspacePath);
  }, [workspacePath]);

  // 捕获到完整快捷键组合时保存
  function handleHotkeyCapture(combo: string) {
    saveHotkey(combo);
  }

  return (
    <div className="mx-auto max-w-xl space-y-8 px-6 py-6">
      <h1 className="text-lg font-semibold">设置</h1>

      {/* 错误提示 */}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* ── 全局唤起快捷键 ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">全局唤起快捷键</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            在任意界面按下此组合键，即可唤起 / 隐藏 Spotlight 搜索窗口。
            修改后立即生效，无需重启。
          </p>
        </div>

        <div className="flex items-center gap-3">
          <HotkeyCapture
            value={hotkey}
            onCapture={handleHotkeyCapture}
            disabled={loading}
          />
          {loading && (
            <span className="text-xs text-muted-foreground">保存中…</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          点击上方控件后，按下目标组合键（需含修饰键，如 Ctrl / Alt / Shift）；按 Esc 取消捕获。
        </p>
      </section>

      <div className="border-t border-border" />

      {/* ── 工作区路径 ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">工作区路径</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Claude / Codex 会话所在的根目录（MVP 阶段仅本地保存，不同步后端）。
          </p>
        </div>

        <input
          type="text"
          aria-label="工作区路径"
          placeholder="/Users/you/projects 或 C:\Users\you\projects"
          value={localPath}
          onChange={(e) => setLocalPath(e.target.value)}
          className={[
            "w-full rounded-md border border-input bg-background px-3 py-1.5",
            "text-sm text-foreground placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring",
          ].join(" ")}
        />

        <p className="text-xs text-muted-foreground">
          留空则使用默认路径（~/.claude / ~/.codex）。
        </p>
      </section>

      <div className="border-t border-border" />

      {/* ── 项目默认打开标签页 ── */}
      <ProjectDefaultTabSection />

      <div className="border-t border-border" />

      {/* ── 看板已完成任务自动归档 ── */}
      <AutoArchiveSection />

      <div className="border-t border-border" />

      {/* ── AI 助手 ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">AI 助手</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            配置项目工作台「AI」标签使用的模型服务；密钥仅保存在本机。
          </p>
        </div>

        {/* 服务商选择 */}
        <div className="space-y-1.5">
          <Label htmlFor="ai-provider">服务商</Label>
          <Select
            value={aiConfig.provider}
            onValueChange={(v) => setAiConfig({ provider: v as AiProvider })}
          >
            <SelectTrigger id="ai-provider" className="w-full">
              <SelectValue placeholder="选择服务商" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI 兼容</SelectItem>
              <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
              <SelectItem value="claude-cli">Claude Code（本地 CLI）</SelectItem>
              <SelectItem value="codex-cli">Codex（本地 CLI）</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 本地 CLI provider 无需 base_url / api_key */}
        {(() => {
          const isCliProvider =
            aiConfig.provider === "claude-cli" || aiConfig.provider === "codex-cli";
          return (
            <>
              {!isCliProvider && (
                <>
                  {/* 接口 Base URL */}
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-base-url">Base URL</Label>
                    <Input
                      id="ai-base-url"
                      type="text"
                      value={aiConfig.base_url}
                      placeholder={
                        aiConfig.provider === "anthropic"
                          ? "https://api.anthropic.com（留空用默认）"
                          : "https://api.openai.com/v1（留空用默认）"
                      }
                      onChange={(e) => setAiConfig({ base_url: e.target.value })}
                    />
                  </div>

                  {/* API 密钥（明文不回显，仅本机保存） */}
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-api-key">API 密钥</Label>
                    <Input
                      id="ai-api-key"
                      type="password"
                      autoComplete="off"
                      value={aiConfig.api_key}
                      placeholder="sk-..."
                      onChange={(e) => setAiConfig({ api_key: e.target.value })}
                    />
                  </div>

                  {/* 模型名称：本地 CLI 由自身决定模型、无需填写，故仅非 CLI 服务商显示。
                      可点「拉取模型」从服务商 /models 接口取建议（datalist），拉不到则手动输入。 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="ai-model">模型</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        disabled={modelsLoading}
                        onClick={() => void fetchModels()}
                      >
                        {modelsLoading ? "拉取中…" : "拉取模型"}
                      </Button>
                    </div>
                    <Input
                      id="ai-model"
                      type="text"
                      list="ai-model-suggestions"
                      value={aiConfig.model}
                      placeholder="gpt-4o-mini / claude-3-5-sonnet-...（可点『拉取模型』获取建议）"
                      onChange={(e) => setAiConfig({ model: e.target.value })}
                    />
                    {models.length > 0 && (
                      <datalist id="ai-model-suggestions">
                        {models.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    )}
                  </div>
                </>
              )}

              {/* CLI provider：可选命令路径 + 说明 */}
              {isCliProvider && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-cli-path">命令路径（可选）</Label>
                    <Input
                      id="ai-cli-path"
                      type="text"
                      value={aiConfig.cli_path ?? ""}
                      placeholder={
                        aiConfig.provider === "codex-cli"
                          ? "留空自动查找；如 C:\\Users\\you\\AppData\\Roaming\\npm\\codex.cmd"
                          : "留空自动查找；如 C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd"
                      }
                      onChange={(e) => setAiConfig({ cli_path: e.target.value })}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    将调用本机的{" "}
                    <code>{aiConfig.provider === "codex-cli" ? "codex" : "claude"}</code>{" "}
                    命令行（走本地订阅，数据不出本机）。若提示「program not found」但终端里能运行，
                    在上面填它的绝对路径即可（终端里用 <code>where {aiConfig.provider === "codex-cli" ? "codex" : "claude"}</code> 查）。
                  </p>
                </>
              )}
            </>
          );
        })()}
      </section>

      <div className="border-t border-border" />

      {/* ── 检索 / 嵌入 ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">检索 / 嵌入</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            配置「问」模式的语义检索嵌入服务；密钥仅保存在本机。
          </p>
        </div>

        {/* 嵌入服务商 */}
        <div className="space-y-1.5">
          <Label htmlFor="embed-provider">嵌入服务商</Label>
          <Select
            value={embedCfg.provider}
            onValueChange={(v) => setEmbed({ provider: v })}
          >
            <SelectTrigger id="embed-provider" className="w-full">
              <SelectValue placeholder="选择嵌入服务商" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">本地 fastembed（数据不出本机）</SelectItem>
              <SelectItem value="api">云 Embeddings API</SelectItem>
              <SelectItem value="mock">Mock（占位假向量 / 非语义）</SelectItem>
            </SelectContent>
          </Select>
          {embedCfg.provider === "mock" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Mock 是占位假向量、非真实语义。「问」模式此时将改用<strong>关键词检索</strong>；要语义检索请选 local 或 api。
            </p>
          )}
          {embedCfg.provider === "local" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              本地嵌入需以 <code>--features local-embed</code> 构建的版本才可用；当前版本若未包含，选它会静默回退关键词。想开箱即用语义，建议用 api（可一键复用 AI 密钥）。
            </p>
          )}
          {/* 主线 A：一键复用 AI 对话的 OpenAI 密钥 */}
          <button
            type="button"
            onClick={reuseAiKey}
            disabled={!aiReusable}
            title={
              aiReusable
                ? "把 AI 对话配置的 OpenAI base_url/密钥填入嵌入(api)"
                : "需先在「AI 助手」把服务商设为 OpenAI 并填密钥"
            }
            className="text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
          >
            复用 AI 对话的 OpenAI 密钥启用语义检索
          </button>
        </div>

        {/* 仅 api 时显示 base_url 和 api_key */}
        {embedCfg.provider === "api" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="embed-base-url">Base URL</Label>
              <Input
                id="embed-base-url"
                type="text"
                value={embedCfg.base_url}
                placeholder="https://api.openai.com/v1（留空用默认）"
                onChange={(e) => setEmbed({ base_url: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="embed-api-key">API 密钥</Label>
              <Input
                id="embed-api-key"
                type="password"
                autoComplete="off"
                value={embedCfg.api_key}
                placeholder="sk-..."
                onChange={(e) => setEmbed({ api_key: e.target.value })}
              />
            </div>
          </>
        )}

        {/* 模型名称（所有 provider 可见） */}
        <div className="space-y-1.5">
          <Label htmlFor="embed-model">模型</Label>
          <Input
            id="embed-model"
            type="text"
            value={embedCfg.model}
            placeholder="text-embedding-3-small"
            onChange={(e) => setEmbed({ model: e.target.value })}
          />
        </div>

        {/* 索引过期提示（provider/model 变了） */}
        {indexStale && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            嵌入配置已变（上次索引用 {lastIndexedModel}），语义检索可能过期，请点「重建索引」。
          </p>
        )}

        {/* 重建索引 + 进度 */}
        <div className="flex items-center gap-3">
          <Button onClick={rebuildIndex} disabled={rebuilding} variant="outline" size="sm">
            {rebuilding ? "索引中…" : "重建索引"}
          </Button>
          {rebuilding && indexProgress != null && (
            <span className="text-xs text-muted-foreground">索引中…（{indexProgress} 会话）</span>
          )}
        </div>

        {/* 数据流向说明 */}
        <p className="text-xs text-muted-foreground">
          {embedCfg.provider === "api"
            ? "使用云 API 时，会话片段将发送到配置的云 Embedding 接口；请确认你的隐私设置。"
            : "当前模式（local / mock）全程不出本机，数据仅在本地处理。"}
        </p>
      </section>

      <div className="border-t border-border" />

      {/* ── MCP 接入（让 claude / codex 操作看板与文档） ── */}
      <McpSection />

      <div className="border-t border-border" />

      {/* ── 运行时（claude-runtime daemon 自检/自动启动/修复） ── */}
      <RuntimeSection />

      <div className="border-t border-border" />

      {/* ── 实时活动 hook（Claude Code 全量工具流，Phase 2） ── */}
      <ActivityHookSection />

      <div className="border-t border-border" />

      {/* ── 看板自动同步（CLI 任务） ── */}
      <AutoSyncTasksSection />

      <div className="border-t border-border" />

      {/* ── 通知偏好 ── */}
      <NotifyPrefsSection />

      <div className="border-t border-border" />

      {/* ── 数据导出 ── */}
      <ExportSection />

      <div className="border-t border-border" />

      {/* ── 软件更新 ── */}
      <UpdateSection />

      <div className="border-t border-border" />

      {/* ── 后端 / 远程 PB ── */}
      <BackendSection />
    </div>
  );
}
