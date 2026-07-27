// WorkspaceProcesses —— 进程管理视图（项目「进程」tab = 按 repo_path 过滤；
// 侧边栏「进程」页 = 全局）。进程列表 + 日志 + start/stop/restart/remove/清理。
// 进程管理为 rework 进程内模块，命令直调；实时事件刷新 + 兜底轮询。
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/tauri/ipc";
import { on } from "@/lib/tauri/events";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RuntimeProcess, RuntimeLog } from "@/types/runtime";

/** 一行日志取可读文本（字段随版本，兜底取 raw/message）。 */
function logText(l: RuntimeLog): string {
  return (l.message || l.raw || "").trim();
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
      if (action === "stop") await ipc.runtimeStop(name);
      else if (action === "restart") await ipc.runtimeRestart(name);
      else await ipc.runtimeRemove(name);
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
    setBusy(true);
    try {
      // name 默认取命令首词 + 时间无关的简短标识（daemon 会去重/覆盖）
      const name = command.split(/\s+/)[0] || "proc";
      await ipc.runtimeStart(command, name, repoPath);
      toast.success(t("processes.toast.startSuccess", { cmd: command }));
      setCmd("");
      await refresh();
    } catch (e) {
      toast.error(t("processes.toast.startError", { msg: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const selectedLogs = useMemo(
    () => logs.map(logText).filter(Boolean),
    [logs],
  );

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
        // 项目模式：启动新进程 + 刷新
        <form
          className="flex shrink-0 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void startNew();
          }}
        >
          <Input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder={t("processes.startPlaceholder")}
            className="flex-1"
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !cmd.trim()}>
            {t("processes.startBtn")}
          </Button>
          {/* 手动刷新：已自动刷新，此处即时刷新 */}
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            title={t("processes.startBtnRefreshTitle")}
            onClick={() => void refresh()}
          >
            {t("processes.refreshBtn")}
          </Button>
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
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          void control("restart", p.name);
                        }}
                        className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
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
              <div className="shrink-0 border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
                {t("processes.logHeader", { name: selected, count: selectedLogs.length })}
              </div>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
