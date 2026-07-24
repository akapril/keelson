// WorkspaceProcesses —— 项目工作台「进程」tab：接入 claude-runtime daemon，
// 显示本项目(按 repo_path 过滤)跑的进程 + 日志 + start/stop/restart。
// daemon 未运行则显示友好提示。轮询刷新(每 4s)。
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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

export function WorkspaceProcesses({ repoPath }: { repoPath: string }) {
  const [available, setAvailable] = useState<boolean | null>(null); // null=检测中
  const [procs, setProcs] = useState<RuntimeProcess[]>([]);
  const [selected, setSelected] = useState<string | null>(null); // 选中查看日志的进程 name
  const [logs, setLogs] = useState<RuntimeLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false); // 「立即修复」拉起 daemon 中
  // 启动新进程的输入
  const [cmd, setCmd] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // 日志滚动容器 + 是否「跟随到底部」（用户往上翻看历史时暂停跟随，滚回底部恢复）
  const logScrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  const refresh = async () => {
    const ok = await ipc.runtimeAvailable().catch(() => false);
    setAvailable(ok);
    if (!ok) {
      setProcs([]);
      return;
    }
    try {
      const list = await ipc.runtimePs(repoPath);
      setProcs(Array.isArray(list) ? list : []);
    } catch {
      setProcs([]);
    }
  };

  // 挂载 + 事件驱动实时刷新（后端进程表一变更就 emit）+ 8s 兜底轮询；切项目重置
  useEffect(() => {
    setSelected(null);
    setLogs([]);
    void refresh();
    // 实时：进程表变更事件 → 即时刷新（一有数据就显示，同活动流机制）
    const un = on("runtime-processes-changed", () => void refresh());
    // 兜底：降到 8s（防漏事件 / 外部 daemon 场景），主要即时性来自事件
    timer.current = setInterval(() => void refresh(), 8000);
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
    const t = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [selected]);

  const control = async (action: "stop" | "restart" | "remove", name: string) => {
    setBusy(true);
    try {
      if (action === "stop") await ipc.runtimeStop(name);
      else if (action === "restart") await ipc.runtimeRestart(name);
      else await ipc.runtimeRemove(name);
      const verb = action === "stop" ? "停止" : action === "restart" ? "重启" : "删除";
      toast.success(`已${verb} ${name}`);
      if (selected === name && action === "remove") setSelected(null);
      await refresh();
    } catch (e) {
      toast.error(`操作失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const startNew = async () => {
    const command = cmd.trim();
    if (!command) return;
    setBusy(true);
    try {
      // name 默认取命令首词 + 时间无关的简短标识（daemon 会去重/覆盖）
      const name = command.split(/\s+/)[0] || "proc";
      await ipc.runtimeStart(command, name, repoPath);
      toast.success(`已启动：${command}`);
      setCmd("");
      await refresh();
    } catch (e) {
      toast.error(`启动失败：${String(e)}`);
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

  // 立即修复：拉起 daemon 后复检（与设置页「立即修复」同一入口）
  const fixDaemon = async () => {
    setFixing(true);
    try {
      const up = await ipc.runtimeEnsureDaemon();
      if (up) {
        toast.success("daemon 已启动");
        await refresh();
      } else {
        toast.error("拉起后仍未连通（:19191 可能被占用）");
      }
    } catch (e) {
      toast.error(`修复失败：${String(e)}`);
    } finally {
      setFixing(false);
    }
  };

  // ── daemon 未运行 ──
  if (available === false) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <p>进程管理 daemon 未运行。</p>
        <p className="text-xs">
          进程管理已内置于 rework、随应用在进程内启动，无需任何外部程序。
          若这里显示未运行，点「立即修复」即可在进程内拉起。
        </p>
        <div className="flex gap-2">
          <Button variant="default" size="sm" disabled={fixing} onClick={() => void fixDaemon()}>
            {fixing ? "启动中…" : "立即修复"}
          </Button>
          <Button variant="outline" size="sm" disabled={fixing} onClick={() => void refresh()}>
            重新检测
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 启动新进程 */}
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
          placeholder="在本项目目录启动进程，如 npm run dev / cargo run"
          className="flex-1"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !cmd.trim()}>
          启动
        </Button>
        {/* 手动刷新：每 4s 已自动刷新，此处即时刷新（不必等一轮轮询） */}
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          title="立即刷新进程列表（每 4s 自动刷新）"
          onClick={() => void refresh()}
        >
          刷新
        </Button>
      </form>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* 进程列表 */}
        <div className="flex w-72 shrink-0 flex-col gap-1.5 overflow-y-auto">
          {available === null ? (
            <p className="py-8 text-center text-xs text-muted-foreground">检测中…</p>
          ) : procs.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              本项目暂无正在托管的进程。在上方输入框启动一个，或让 Claude Code 起长驻进程自动托管。
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
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {running ? "运行中" : p.status}
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
                        重启
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
                          停止
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
                          删除
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
              选择左侧进程查看日志
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="shrink-0 border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
                {selected} · 最近 {selectedLogs.length} 条日志
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
                  <p className="text-xs text-muted-foreground">暂无日志。</p>
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
