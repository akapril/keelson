// 新建项目对话框：收集名称 / 描述 / 仓库路径 + 模板选择，
// 调用 createProjectFromTemplate，成功后刷新项目列表并关闭。
import { useState, type FormEvent } from "react";
import { useBoardStore } from "../../store/board";
import { createProjectFromTemplate } from "./create-project";

// ── Props ──────────────────────────────────────────────────────
interface CreateProjectDialogProps {
  /** 关闭对话框的回调 */
  onClose: () => void;
}

/**
 * 新建项目对话框（受控模态框）。
 * 父组件控制显示/隐藏，通过 onClose 关闭。
 */
export function CreateProjectDialog({ onClose }: CreateProjectDialogProps) {
  const templates = useBoardStore((s) => s.templates);
  const loadProjects = useBoardStore((s) => s.loadProjects);

  // ── 表单状态 ──────────────────────────────────────────────
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [repoPath, setRepoPath] = useState("");
  // 默认选中第一个模板（若存在）
  const [templateId, setTemplateId] = useState<string>(
    templates[0]?.id ?? "",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // ── 提交处理 ──────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);

    // 找到所选模板对象
    const template = templates.find((t) => t.id === templateId);
    if (!template) {
      setError("请选择一个模板");
      return;
    }
    if (!name.trim()) {
      setError("项目名称不能为空");
      return;
    }

    setLoading(true);
    try {
      await createProjectFromTemplate({
        name: name.trim(),
        description: description.trim() || undefined,
        repo_path: repoPath.trim() || undefined,
        template,
      });
      // 刷新项目列表后关闭对话框
      await loadProjects();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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
      aria-labelledby="create-project-title"
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
            id="create-project-title"
            className="text-base font-semibold text-foreground"
          >
            新建项目
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
          {/* 项目名称（必填） */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cp-name"
              className="text-sm font-medium text-foreground"
            >
              项目名称
              <span className="ml-1 text-destructive">*</span>
            </label>
            <input
              id="cp-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入项目名称"
              disabled={loading}
              className={[
                "rounded-md border border-input bg-background px-3 py-2",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50",
              ].join(" ")}
            />
          </div>

          {/* 描述（可选） */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cp-desc"
              className="text-sm font-medium text-foreground"
            >
              描述
              <span className="ml-1 text-xs text-muted-foreground">（可选）</span>
            </label>
            <textarea
              id="cp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简短描述项目用途"
              rows={2}
              disabled={loading}
              className={[
                "resize-none rounded-md border border-input bg-background px-3 py-2",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50",
              ].join(" ")}
            />
          </div>

          {/* 仓库路径（可选） */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cp-repo"
              className="text-sm font-medium text-foreground"
            >
              仓库路径
              <span className="ml-1 text-xs text-muted-foreground">（可选）</span>
            </label>
            <input
              id="cp-repo"
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="/path/to/repo 或留空"
              disabled={loading}
              className={[
                "rounded-md border border-input bg-background px-3 py-2",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50",
              ].join(" ")}
            />
          </div>

          {/* 模板选择 */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cp-template"
              className="text-sm font-medium text-foreground"
            >
              模板
              <span className="ml-1 text-destructive">*</span>
            </label>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无可用模板</p>
            ) : (
              <select
                id="cp-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                disabled={loading}
                className={[
                  "rounded-md border border-input bg-background px-3 py-2",
                  "text-sm text-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                  "disabled:opacity-50",
                ].join(" ")}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.description ? ` — ${t.description}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

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
              disabled={loading || templates.length === 0}
              className={[
                "rounded-md bg-primary px-4 py-2 text-sm font-medium",
                "text-primary-foreground shadow-sm",
                "hover:bg-primary/90",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50",
              ].join(" ")}
            >
              {loading ? "创建中…" : "创建"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
