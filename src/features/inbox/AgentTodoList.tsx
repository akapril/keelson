// AgentTodoList —— Agent 待办收件箱列表：加载待决策 runs + 状态过滤 + 空态 + 实时订阅。
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { listPendingAgentRuns } from "@/lib/pb/agent-runs";
import { useAgentStore } from "@/store/agents";
import { useBoardStore } from "@/store/board";
import { AgentTodoRow } from "./AgentTodoRow";
import type { AgentRun, AgentRunStatus } from "@/types/agent";

// 支持的过滤状态（undefined = 全部）
type FilterStatus = AgentRunStatus | "all";

/**
 * Agent 待办收件箱列表。
 *
 * - 挂载时拉 `listPendingAgentRuns()`；订阅 `agent-run-changed` 实时重拉。
 * - 状态过滤：全部 / 待审(review) / 受阻(blocked)。
 * - 列表顶部显示条目数；空态友好提示。
 * - 渲染 `AgentTodoRow`，`onDone` 触发重拉（行动作后列表自刷新）。
 */
export function AgentTodoList() {
  // 全部待决策 runs（未过滤）
  const [runs, setRuns] = useState<AgentRun[]>([]);
  // 当前过滤器
  const [filter, setFilter] = useState<FilterStatus>("all");
  // 是否正在加载
  const [loading, setLoading] = useState(false);

  // ── 确保 agents store 已加载（队友名映射） ───────────────────────────────────
  const agentStoreLoad = useAgentStore((s) => s.load);
  const agentsLoaded = useAgentStore((s) => s.loaded);

  // ── best-effort 加载 board 数据（项目名/任务标题映射）──────────────────────
  // board store 的 projects 可能已由其他页面加载；若空则触发一次 loadProjects。
  // tasks 只在打开项目时加载（listTasks 需要 projectId），故 AgentTodoRow 按 id 兜底。
  const boardProjects = useBoardStore((s) => s.projects);
  const loadProjects = useBoardStore((s) => s.loadProjects);

  // ── 拉取待决策 runs ──────────────────────────────────────────────────────────
  const fetchRuns = useCallback(() => {
    setLoading(true);
    listPendingAgentRuns()
      .then((data) => setRuns(data))
      .catch((e) => toast.error(`加载待办 runs 失败：${String(e)}`))
      .finally(() => setLoading(false));
  }, []);

  // ── 挂载时：拉取 runs + 确保依赖数据加载 ──────────────────────────────────
  useEffect(() => {
    // 拉取 runs
    fetchRuns();

    // 确保命名队友列表已加载（幂等，loaded 时 store 可自行短路）
    if (!agentsLoaded) {
      void agentStoreLoad().catch(() => {
        // 加载失败不崩溃，AgentTodoRow 会用 providerLabel 兜底
      });
    }

    // 确保项目列表已加载（best-effort；已有数据则跳过）
    if (boardProjects.length === 0) {
      void loadProjects().catch(() => {
        // 加载失败不崩溃，AgentTodoRow 会用 id 尾 6 位兜底
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // 依赖仅 fetchRuns，避免 boardProjects.length 变化时死循环
  }, [fetchRuns]);

  // ── 订阅 agent-run-changed 事件：后台 worker 产出新 run 时实时重拉 ──────────
  useEffect(() => {
    let cancelled = false;

    // listen 返回 Promise<UnlistenFn>；挂载时订阅，卸载时取消
    const unlistenPromise = listen<string>("agent-run-changed", () => {
      // 任何 run 变更（不限任务 id）都重拉，保持列表最新
      if (cancelled) return;
      listPendingAgentRuns()
        .then((data) => {
          if (!cancelled) setRuns(data);
        })
        .catch(() => undefined); // 实时刷新失败静默忽略（主动拉取已 toast）
    });

    return () => {
      // 标记已卸载，防止 setState-after-unmount
      cancelled = true;
      void unlistenPromise.then((f) => f());
    };
  }, []);

  // ── 过滤（本地，无需重拉） ──────────────────────────────────────────────────
  const visible = filter === "all" ? runs : runs.filter((r) => r.status === filter);

  // ── 过滤按钮样式辅助 ────────────────────────────────────────────────────────
  const filterBtnCls = (f: FilterStatus) =>
    `rounded-lg border px-2.5 py-1 text-xs transition-colors ${
      filter === f
        ? "border-primary/40 bg-accent text-primary"
        : "border-border text-muted-foreground hover:bg-accent/50"
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ── 顶部工具栏：计数 + 过滤 ──────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {/* 待决策总数徽标 */}
        <span className="text-sm font-medium text-foreground">
          Agent 待办
          {runs.length > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
              {runs.length}
            </span>
          )}
        </span>

        {/* 分隔 */}
        <div className="flex-1" />

        {/* 状态过滤按钮组 */}
        <div className="flex items-center gap-1.5">
          <button type="button" className={filterBtnCls("all")} onClick={() => setFilter("all")}>
            全部
          </button>
          <button type="button" className={filterBtnCls("review")} onClick={() => setFilter("review")}>
            待审
          </button>
          <button type="button" className={filterBtnCls("blocked")} onClick={() => setFilter("blocked")}>
            受阻
          </button>
        </div>
      </div>

      {/* ── 列表区 ────────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 加载态 */}
        {loading && runs.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
        )}

        {/* 空态 */}
        {!loading && visible.length === 0 && (
          <p className="py-16 text-center text-sm text-muted-foreground">
            没有待决策的 agent 运行
          </p>
        )}

        {/* run 列表 */}
        {visible.length > 0 && (
          <div className="flex flex-col gap-2">
            {visible.map((run) => (
              <AgentTodoRow
                key={run.id}
                run={run}
                onDone={fetchRuns} // 操作完成后重拉列表（行乐观离开，状态变为 merged/discarded）
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
