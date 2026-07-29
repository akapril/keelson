// WorkspaceProcesses —— 进程管理视图（项目「进程」tab = 按 repo_path 过滤；
// 侧边栏「进程」页 = 全局）。进程列表 + 日志 + start/stop/restart/remove/清理。
// 进程管理为 rework 进程内模块，命令直调；实时事件刷新 + 兜底轮询。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/tauri/ipc";
import { on } from "@/lib/tauri/events";
import { cn } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RuntimeProcess, RuntimeLog } from "@/types/runtime";
import { InteractivePtyView } from "@/components/terminal/InteractivePtyView";
import { CommandPicker } from "./CommandPicker";
import { addHistory, toggleFavorite, isFavorite, loadCommands, recallCommand } from "./command-store";
import { scriptToCommand } from "./script-command";

/** 是否 Windows（影响 .sh 脚本的解释器：bash vs sh）。 */
const IS_WINDOWS = typeof navigator !== "undefined" && /win/i.test(navigator.userAgent);

/** 一行日志取可读文本（字段随版本，兜底取 raw/message）。 */
function logText(l: RuntimeLog): string {
  return (l.message || l.raw || "").trim();
}

/** 文件夹图标（内联线性 SVG，与全站 TabIcon 风格一致，替代 emoji）。 */
function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/** 重置/回退图标（逆时针箭头，内联线性 SVG）。 */
function ResetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
    </svg>
  );
}

// repoPath 有值=项目模式（按仓库路径过滤 + 可在本目录启动）；
// 无值=全局模式（侧边栏「进程」页：显示所有托管进程，不过滤，不提供启动，附清理入口）。
export function WorkspaceProcesses({ repoPath }: { repoPath?: string }) {
  const { t } = useTranslation("board");
  const global = !repoPath;
  const navigate = useNavigate();
  const [procs, setProcs] = useState<RuntimeProcess[]>([]);
  const [loaded, setLoaded] = useState(false); // 首次加载完成前不显示"空"文案
  const [selected, setSelected] = useState<string | null>(null); // 选中查看日志的进程 name
  const [logs, setLogs] = useState<RuntimeLog[]>([]);
  const [busy, setBusy] = useState(false);
  // 启动新进程的输入
  const [cmd, setCmd] = useState("");
  // 是否以交互式 PTY 启动（sudo 等需输入密码的命令）
  const [interactive, setInteractive] = useState(false);
  // 选择的工作目录（null=用项目根 repoPath）
  const [cwd, setCwd] = useState<string | null>(null);
  // 命令收藏/历史变更计数：收藏当前 / 启动记历史 / Picker 内改动后 +1，触发 Picker 重载
  const [cmdVersion, setCmdVersion] = useState(0);
  // 终端式 ↑/↓ 历史导航：当前索引（-1=草稿）+ 草稿暂存
  const [histIdx, setHistIdx] = useState(-1);
  const draftRef = useRef("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // 日志滚动容器 + 是否「跟随到底部」（用户往上翻看历史时暂停跟随，滚回底部恢复）
  const logScrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  // 进程管理为 rework 进程内模块，恒可用（无 TCP/daemon 未运行态）——直接拉进程表。
  const refresh = async () => {
    try {
      // 全局模式传空串 = 不过滤（后端 !project.is_empty() 守卫）
      const list = await ipc.runtimePs(repoPath ?? "");
      setProcs(Array.isArray(list) ? list : []);
    } catch {
      setProcs([]);
    } finally {
      setLoaded(true);
    }
  };

  // 挂载 + 事件驱动实时刷新（后端进程表一变更就 emit）+ 8s 兜底轮询；切项目重置
  useEffect(() => {
    setSelected(null);
    setLogs([]);
    setCwd(null); // 切项目重置工作目录为该项目根
    void refresh();
    // 实时：进程表变更事件 → 即时刷新（一有数据就显示，同活动流机制）
    const un = on("runtime-processes-changed", () => void refresh());
    // 兜底：降到 8s（防漏事件），主要即时性来自事件。页面不可见时跳过。
    timer.current = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 8000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      void un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath]);

  // 选中进程后拉日志(跟随轮询)
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const load = () =>
      void ipc
        .runtimeLogs(selected, 200)
        .then((ls) => !cancelled && setLogs(Array.isArray(ls) ? ls : []))
        .catch(() => !cancelled && setLogs([]));
    load();
    // 日志轮询提速到 1s：选中进程时才轮询，接近实时（比每行 emit 更稳，
    // 高频输出的进程不会刷爆前端——拉最近 N 行天然合批）。
    // 页面不可见（切到别的 app/最小化）时跳过轮询省 IPC/CPU，切回来立即补拉一次。
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [selected]);

  const control = async (action: "stop" | "restart" | "remove", name: string) => {
    setBusy(true);
    try {
      if (action === "stop") {
        // 交互式进程走 PTY kill（发 SIGKILL/TerminateProcess），非交互走 PID stop
        const proc = procs.find((p) => p.name === name);
        if (proc?.interactive) {
          await ipc.runtimePtyKill(proc.id);
        } else {
          await ipc.runtimeStop(name);
        }
      } else if (action === "restart") {
        await ipc.runtimeRestart(name);
      } else {
        await ipc.runtimeRemove(name);
      }
      const successMsg = action === "stop"
        ? t("processes.toast.stop", { name })
        : action === "restart"
        ? t("processes.toast.restart", { name })
        : t("processes.toast.remove", { name });
      toast.success(successMsg);
      if (selected === name && action === "remove") setSelected(null);
      await refresh();
    } catch (e) {
      toast.error(t("processes.toast.error", { msg: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  // 全局清理：移除所有已停止/退出记录 + 删 7 天前日志
  const cleanup = async () => {
    setBusy(true);
    try {
      const r = await ipc.runtimeClean(7);
      toast.success(t("processes.toast.cleanSuccess", { processes: r.processes_removed, logs: r.log_files_deleted }));
      if (selected) setSelected(null);
      await refresh();
    } catch (e) {
      toast.error(t("processes.toast.cleanError", { msg: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const startNew = async () => {
    const command = cmd.trim();
    if (!command || !repoPath) return;
    // 工作目录：选了就用选的，否则用项目根
    const effectiveCwd = cwd ?? repoPath;
    setBusy(true);
    try {
      // name 默认取命令首词（daemon 会去重/覆盖）
      const name = command.split(/\s+/)[0] || "proc";
      if (interactive) {
        // 交互式 PTY 启动（sudo / ssh 等需要终端输入的命令）
        const p = await ipc.runtimePtyStart(command, name, effectiveCwd);
        // 启动后自动选中该进程，右侧立即显示交互终端等待输入
        setSelected(p.name);
      } else {
        // 普通 headless 进程（看门狗、日志 tee、PID 判活）
        await ipc.runtimeStart(command, name, effectiveCwd);
      }
      // 自动记入历史（命令+cwd），供下次一键重跑
      addHistory(repoPath, { command, cwd: effectiveCwd });
      setCmdVersion((v) => v + 1);
      toast.success(t("processes.toast.startSuccess", { cmd: command }));
      setCmd("");
      setHistIdx(-1); // 启动后回到草稿态
      await refresh();
    } catch (e) {
      toast.error(t("processes.toast.startError", { msg: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  // 选工作目录：原生文件夹选择 → 作为本次启动 cwd（默认项目根，可重置）
  const pickDirectory = async () => {
    try {
      const dir = await open({ directory: true, multiple: false, defaultPath: cwd ?? repoPath });
      if (typeof dir === "string") setCwd(dir);
    } catch (e) {
      toast.error(t("processes.launch.pickError", { msg: String(e) }));
    }
  };

  // 选脚本：原生文件选择 → 按扩展名填成命令 + cwd 设为脚本目录（均可再编辑）
  const pickScript = async () => {
    try {
      const file = await open({ directory: false, multiple: false, defaultPath: cwd ?? repoPath });
      if (typeof file === "string") {
        const { command, cwd: scriptDir } = scriptToCommand(file, IS_WINDOWS);
        setCmd(command);
        if (scriptDir) setCwd(scriptDir);
      }
    } catch (e) {
      toast.error(t("processes.launch.pickError", { msg: String(e) }));
    }
  };

  // 收藏/取消收藏当前命令（连同当前 cwd）
  const saveFavorite = () => {
    const command = cmd.trim();
    if (!command || !repoPath) return;
    toggleFavorite(repoPath, { command, cwd: cwd ?? repoPath });
    setCmdVersion((v) => v + 1);
  };
  // 当前命令是否已收藏（用于收藏按钮的星态）
  const currentFavored =
    !!repoPath && cmd.trim().length > 0 && isFavorite(repoPath, { command: cmd.trim(), cwd: cwd ?? repoPath });

  // ↑/↓ 历史导航用的命令文本列表（最近在前）；cmdVersion 作刷新触发器（记历史/收藏后重读）
  const historyCommands = useMemo(
    () => (repoPath ? loadCommands(repoPath).history.map((h) => h.command) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cmdVersion 是刷新触发器，非 memo 体内引用
    [repoPath, cmdVersion],
  );

  // 命令框按 ↑/↓ 回溯历史（终端习惯）。首次 ↑ 暂存当前草稿，↓ 回到底部还原草稿。
  const onCmdKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const dir = e.key === "ArrowUp" ? "up" : "down";
    if (dir === "up" && histIdx < 0) draftRef.current = cmd; // 进入历史前存草稿
    const r = recallCommand(historyCommands, histIdx, dir, draftRef.current);
    if (r) {
      e.preventDefault(); // 阻止光标跳到行首/行尾
      setHistIdx(r.idx);
      setCmd(r.value);
    }
  };

  // 清空选中进程的日志（截断 <id>.log）。进程在跑也可清，后续日志从头续写。
  const clearLogs = async (name: string) => {
    try {
      await ipc.runtimeClearLogs(name);
      setLogs([]); // 立即清空视图；1s 轮询读到空文件后保持空
      toast.success(t("processes.clearLogsSuccess"));
    } catch (e) {
      toast.error(t("processes.clearLogsError", { msg: String(e) }));
    }
  };

  const selectedLogs = useMemo(
    () => logs.map(logText).filter(Boolean),
    [logs],
  );

  // 当前选中的进程实体（用于判断是否交互式）
  const selectedProc = useMemo(
    () => procs.find((p) => p.name === selected) ?? null,
    [procs, selected],
  );
  // 交互式 PTY 进程且正在运行：右侧渲染可输入终端而非只读日志
  const showPtyTerminal = !!selectedProc?.interactive && selectedProc.status === "running";

  // 切换进程：重置为「跟随」（回到看最新日志）
  useEffect(() => {
    followRef.current = true;
  }, [selected]);

  // 日志更新后：若处于跟随态则滚到底部（新日志进来自动跟到最新）
  useEffect(() => {
    const el = logScrollRef.current;
    if (el && followRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [selectedLogs, selected]);


  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {global ? (
        // 全局模式：不提供启动（启动属具体项目），改提供刷新 + 清理停止/退出记录
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("processes.globalDesc", { count: procs.length })}
          </span>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>
              {t("processes.refreshBtn")}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void cleanup()}>
              {t("processes.cleanBtn")}
            </Button>
          </div>
        </div>
      ) : (
        // 项目模式：启动新进程（命令 + 历史/收藏 + 目录 + 脚本）+ 刷新
        <form
          className="flex shrink-0 flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void startNew();
          }}
        >
          {/* 行1：命令输入 + 历史下拉 + 交互式 + 启动 */}
          <div className="flex items-center gap-2">
            <Input
              value={cmd}
              onChange={(e) => {
                setCmd(e.target.value);
                setHistIdx(-1); // 用户手动编辑 → 脱离历史导航
              }}
              onKeyDown={onCmdKeyDown}
              placeholder={t("processes.startPlaceholder")}
              className="flex-1"
              disabled={busy}
            />
            {/* 历史/收藏下拉：点选回填命令+cwd */}
            <CommandPicker
              projectKey={repoPath!}
              version={cmdVersion}
              onPick={(e) => {
                setCmd(e.command);
                setCwd(e.cwd ?? null);
                setHistIdx(-1); // 下拉选完后从草稿态重新计
              }}
              onChanged={() => setCmdVersion((v) => v + 1)}
            />
            {/* 交互式启动 checkbox：sudo / ssh 等需要终端输入的命令勾选此项 */}
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={interactive}
                onChange={(e) => setInteractive(e.target.checked)}
                disabled={busy}
              />
              {t("processes.interactiveLabel")}
            </label>
            <Button type="submit" disabled={busy || !cmd.trim()}>
              {t("processes.startBtn")}
            </Button>
          </div>

          {/* 行2：工作目录展示 + 选目录 + 选脚本 + 收藏当前 + 刷新 */}
          <div className="flex items-center gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground" title={cwd ?? repoPath}>
              <FolderIcon className="size-3.5 shrink-0" />
              <span className="truncate">{cwd ? cwd : t("processes.launch.projectRoot")}</span>
            </span>
            {cwd && (
              <button
                type="button"
                onClick={() => setCwd(null)}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                title={t("processes.launch.resetCwd")}
                aria-label={t("processes.launch.resetCwd")}
              >
                <ResetIcon className="size-3.5" />
              </button>
            )}
            <div className="ml-auto flex shrink-0 gap-1.5">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void pickDirectory()}>
                {t("processes.launch.pickDir")}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void pickScript()}>
                {t("processes.launch.pickScript")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !cmd.trim()}
                onClick={saveFavorite}
                title={t("processes.launch.saveFavorite")}
                className={currentFavored ? "text-amber-500" : undefined}
              >
                {currentFavored ? "★" : "☆"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                title={t("processes.startBtnRefreshTitle")}
                onClick={() => void refresh()}
              >
                {t("processes.refreshBtn")}
              </Button>
            </div>
          </div>
        </form>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        {/* 进程列表 */}
        <div className="flex w-72 shrink-0 flex-col gap-1.5 overflow-y-auto">
          {!loaded ? (
            <p className="py-8 text-center text-xs text-muted-foreground">{t("processes.loading")}</p>
          ) : procs.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {global
                ? t("processes.emptyGlobal")
                : t("processes.emptyProject")}
            </p>
          ) : (
            procs.map((p) => {
              const running = p.status === "running";
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p.name)}
                  className={cn(
                    "flex flex-col gap-1 rounded-xl border p-2.5 text-left transition-colors",
                    selected === p.name
                      ? "border-primary/50 bg-primary/5"
                      : "border-border bg-card hover:bg-accent/40",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        running ? "bg-green-500" : "bg-muted-foreground/40",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {p.name}
                    </span>
                    {p.port.length > 0 && (
                      <span className="shrink-0 rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
                        :{p.port.join(",")}
                      </span>
                    )}
                  </div>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {p.command}
                  </span>
                  {/* 全局模式：显示 cwd，便于辨认进程所属目录/项目 */}
                  {global && (
                    <span className="truncate text-[10px] text-muted-foreground/70" title={p.cwd}>
                      {p.cwd}
                    </span>
                  )}
                  {/* 会话溯源：intercept 自动托管的进程带来源会话 → 徽章点击跳会话中枢 */}
                  {p.session_id && (
                    <span
                      role="button"
                      tabIndex={0}
                      title={t("processes.sessionBadgeTitle", { id: p.session_id })}
                      onClick={(e) => {
                        e.stopPropagation();
                        const params = new URLSearchParams({ session: p.session_id! });
                        if (p.provider) params.set("provider", p.provider);
                        navigate(`/sessions?${params.toString()}`);
                      }}
                      className="w-fit rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/20"
                    >
                      {t("processes.sessionBadge")}
                    </span>
                  )}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {running ? t("processes.running") : p.status}
                      {p.health && p.health !== "unknown" ? ` · ${p.health}` : ""}
                    </span>
                    <span className="ml-auto flex gap-1">
                      {/* 交互式进程不支持自动重启：提示用户手动停止后重新启动 */}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (p.interactive) {
                            toast.info(t("processes.interactiveNoRestart"));
                            return;
                          }
                          void control("restart", p.name);
                        }}
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px]",
                          p.interactive
                            ? "cursor-default text-muted-foreground/40"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                        title={p.interactive ? t("processes.interactiveNoRestart") : undefined}
                      >
                        {t("processes.restartBtn")}
                      </span>
                      {running ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            void control("stop", p.name);
                          }}
                          className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          {t("processes.stopBtn")}
                        </span>
                      ) : (
                        // 已退出/停止：允许删除记录（连同日志文件）
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            void control("remove", p.name);
                          }}
                          className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          {t("processes.removeBtn")}
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* 日志 */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("processes.selectProcess")}
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
                {/* 交互式 PTY 终端模式显示「终端 · 进程名」，不显示日志计数；否则显示日志计数 */}
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                  {showPtyTerminal
                    ? t("processes.pty.terminalHeader", { name: selected })
                    : t("processes.logHeader", { name: selected, count: selectedLogs.length })}
                </span>
                {/* 清空日志：截断 <id>.log。终端模式不显示（xterm 缓冲另算，非日志文件） */}
                {!showPtyTerminal && selected && (
                  <button
                    type="button"
                    onClick={() => void clearLogs(selected)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    title={t("processes.clearLogs")}
                  >
                    {t("processes.clearLogs")}
                  </button>
                )}
              </div>
              {showPtyTerminal ? (
                // 交互式 PTY 进程运行中：渲染可输入终端（xterm）；id 变时自动重挂
                <div className="min-h-0 flex-1 overflow-hidden bg-background">
                  <InteractivePtyView id={selectedProc!.id} className="size-full" />
                </div>
              ) : (
                // 普通进程 / 交互进程已退出：只读日志（tee 落盘，支持回看）
                <div
                  ref={logScrollRef}
                  onScroll={() => {
                    const el = logScrollRef.current;
                    if (!el) return;
                    // 距底部 <40px 视为「在底部」→ 跟随；往上翻则暂停跟随
                    followRef.current =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                  }}
                  className="min-h-0 flex-1 overflow-auto p-3"
                >
                  {selectedLogs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("processes.noLogs")}</p>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
                      {selectedLogs.join("\n")}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
