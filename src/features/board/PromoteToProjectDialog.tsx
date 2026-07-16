// 提升为看板项目对话框：将会话中枢里的某个 project_path 提升为受管的看板项目。
// 预填名称（路径末段）+ 只读仓库路径，用户选择模板后调用 store.createProject，
// 成功后打开该项目并跳转到看板路由。组件不直接调用 invoke / pb.collection，一律走 store。
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useBoardStore } from "../../store/board";
import { workspaceRecordUrl } from "../../lib/workspace-navigation";

// ── Props ──────────────────────────────────────────────────────
interface PromoteToProjectDialogProps {
  /** 待提升的会话项目路径（作为 repo_path，只读展示） */
  projectPath: string;
  /** 关闭对话框的回调 */
  onClose: () => void;
}

/**
 * 从会话项目路径提取可读的项目名：按 `/` 或 `\` 分割，取最后一个非空段。
 */
function lastPathSegment(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;
}

/**
 * 提升为看板项目对话框（受控模态框）。
 * 父组件控制显示/隐藏，通过 onClose 关闭。
 */
export function PromoteToProjectDialog({
  projectPath,
  onClose,
}: PromoteToProjectDialogProps) {
  const templates = useBoardStore((s) => s.templates);
  const loadTemplates = useBoardStore((s) => s.loadTemplates);
  const navigate = useNavigate();

  // ── 表单状态 ──────────────────────────────────────────────
  // 名称预填为路径末段
  const [name, setName] = useState(() => lastPathSegment(projectPath));
  const [templateId, setTemplateId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // ── 挂载时确保模板已加载 ──────────────────────────────────
  useEffect(() => {
    if (templates.length === 0) {
      void loadTemplates();
    }
    // 仅在挂载时判断一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 模板加载后默认选中第一个 ──────────────────────────────
  useEffect(() => {
    if (!templateId && templates.length > 0) {
      setTemplateId(templates[0].id);
    }
  }, [templates, templateId]);

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
      // 通过 store 创建项目（repo_path 固定为待提升的会话项目路径）
      const project = await useBoardStore.getState().createProject({
        name: name.trim(),
        repo_path: projectPath,
        template,
      });
      // 打开新建的项目并跳转到项目工作台（?open= 深链接）
      await useBoardStore.getState().openProject(project.id);
      navigate(workspaceRecordUrl("board", project.id));
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
      aria-labelledby="promote-project-title"
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
            id="promote-project-title"
            className="text-base font-semibold text-foreground"
          >
            提升为看板项目
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
          {/* 项目名称（必填，预填路径末段） */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="pp-name"
              className="text-sm font-medium text-foreground"
            >
              项目名称
              <span className="ml-1 text-destructive">*</span>
            </label>
            <input
              id="pp-name"
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

          {/* 仓库路径（只读，固定为会话项目路径） */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="pp-repo"
              className="text-sm font-medium text-foreground"
            >
              仓库路径
              <span className="ml-1 text-xs text-muted-foreground">（来自会话项目）</span>
            </label>
            <input
              id="pp-repo"
              type="text"
              readOnly
              value={projectPath}
              title={projectPath}
              className={[
                "rounded-md border border-input bg-muted px-3 py-2",
                "text-sm text-muted-foreground",
                "focus:outline-none",
              ].join(" ")}
            />
          </div>

          {/* 模板选择 */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="pp-template"
              className="text-sm font-medium text-foreground"
            >
              模板
              <span className="ml-1 text-destructive">*</span>
            </label>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">加载模板中…</p>
            ) : (
              <select
                id="pp-template"
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
              {loading ? "提升中…" : "提升"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
