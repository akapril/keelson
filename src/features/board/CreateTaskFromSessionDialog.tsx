// 从会话建任务对话框：预填标题（来自会话最后/首条提示词），
// 选择目标看板项目（默认匹配 repo_path === session.project_path），
// 提交时解析该项目首个状态列，调用 createTask 并写入来源溯源字段。
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useBoardStore } from "../../store/board";
import type { Session } from "../../types/session";

// ── 工具函数：截断提示词文本 ──────────────────────────────────
/** 将字符串截断至 maxLen 字符，超出部分用省略号代替 */
function truncate(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "…";
}

// ── Props ──────────────────────────────────────────────────────
interface CreateTaskFromSessionDialogProps {
  /** 来源会话 */
  session: Session;
  /** 关闭对话框的回调 */
  onClose: () => void;
}

/**
 * 从会话创建看板任务的对话框（受控模态框）。
 * 默认目标项目：repo_path 与会话 project_path 一致的看板项目（若存在）。
 */
export function CreateTaskFromSessionDialog({
  session,
  onClose,
}: CreateTaskFromSessionDialogProps) {
  const projects = useBoardStore((s) => s.projects);
  const loadProjects = useBoardStore((s) => s.loadProjects);

  // 挂载时确保项目列表已加载（供项目下拉框使用）
  useEffect(() => {
    if (projects.length === 0) {
      void loadProjects();
    }
    // 仅在挂载时触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 默认项目：优先匹配 repo_path === session.project_path ───────
  const defaultProjectId = useMemo(() => {
    const matched = projects.find(
      (p) => p.repo_path && p.repo_path === session.project_path,
    );
    return matched?.id ?? projects[0]?.id ?? "";
  }, [projects, session.project_path]);

  // ── 表单状态 ──────────────────────────────────────────────
  const [title, setTitle] = useState(
    truncate(session.last_prompt || session.first_prompt || ""),
  );
  const [projectId, setProjectId] = useState<string>(defaultProjectId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // 项目列表异步加载完成后，同步默认选中项（用户尚未手动选择时）
  useEffect(() => {
    if (!projectId && defaultProjectId) {
      setProjectId(defaultProjectId);
    }
  }, [defaultProjectId, projectId]);

  // ── 提交处理 ──────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);

    if (!projectId) {
      setError("请先选择目标项目（可先在会话中枢将其提升为看板项目）");
      return;
    }
    if (!title.trim()) {
      setError("任务标题不能为空");
      return;
    }

    setLoading(true);
    try {
      const store = useBoardStore.getState();
      // 打开目标项目以加载其状态列，取首个状态列作为落点
      await store.openProject(projectId);
      const firstState = useBoardStore.getState().states[0];
      if (!firstState) {
        setError("该项目暂无状态列，无法创建任务");
        setLoading(false);
        return;
      }
      // 创建任务并写入来源溯源字段
      await useBoardStore.getState().createTask({
        project: projectId,
        state: firstState.id,
        title: title.trim(),
        source_session_id: session.session_id,
        source_provider: session.provider,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  // ── 点击遮罩层关闭（仅在非加载时） ──────────────────────
  function handleBackdropClick() {
    if (!loading) onClose();
  }

  // ── 渲染 ──────────────────────────────────────────────────
  return (
    /* 遮罩层 */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-task-from-session-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      {/* 对话框面板（阻止冒泡，防止点击内容区关闭） */}
      <div
        className={[
          "w-full max-w-md rounded-xl border border-border",
          "bg-card p-6 shadow-lg",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题行 */}
        <div className="mb-5 flex items-center justify-between">
          <h2
            id="create-task-from-session-title"
            className="text-base font-semibold text-foreground"
          >
            从会话建任务
          </h2>
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            ✕
          </button>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* 任务标题（必填，预填自会话提示词） */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cts-title"
              className="text-sm font-medium text-foreground"
            >
              任务标题
              <span className="ml-1 text-destructive">*</span>
            </label>
            <input
              id="cts-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入任务标题"
              disabled={loading}
              className={[
                "rounded-md border border-input bg-background px-3 py-2",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50",
              ].join(" ")}
            />
          </div>

          {/* 目标项目选择 */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cts-project"
              className="text-sm font-medium text-foreground"
            >
              目标项目
              <span className="ml-1 text-destructive">*</span>
            </label>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                暂无看板项目，请先在会话中枢将其提升为看板项目。
              </p>
            ) : (
              <select
                id="cts-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={loading}
                className={[
                  "rounded-md border border-input bg-background px-3 py-2",
                  "text-sm text-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                  "disabled:opacity-50",
                ].join(" ")}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.repo_path === session.project_path ? "（匹配仓库）" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 来源会话信息（只读展示） */}
          <p className="text-xs text-muted-foreground">
            来源会话：
            <span className="ml-1 font-mono">{session.provider}</span>
            <span className="ml-1 font-mono">
              {session.session_id.slice(0, 8)}…
            </span>
          </p>

          {/* 错误提示 */}
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          {/* 操作按钮行 */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className={[
                "rounded-md px-4 py-2 text-sm font-medium",
                "border border-border text-foreground",
                "hover:bg-accent hover:text-accent-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50",
              ].join(" ")}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || projects.length === 0}
              className={[
                "rounded-md bg-primary px-4 py-2 text-sm font-medium",
                "text-primary-foreground shadow-sm",
                "hover:bg-primary/90",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50",
              ].join(" ")}
            >
              {loading ? "创建中…" : "创建任务"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
