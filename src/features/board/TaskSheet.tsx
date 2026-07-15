// 任务创建/编辑面板：受控模态框。
// 数据访问统一走 useBoardStore（createTask / updateTask），本组件不直接调用 invoke 或 pb.collection。
import { useEffect, useState, type FormEvent } from "react";
import { useBoardStore } from "../../store/board";
import type { BoardTask, TaskPriority } from "../../types/board";

// ── 优先级下拉选项（顺序 = 展示顺序） ─────────────────────────
const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "none", label: "无" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "urgent", label: "紧急" },
];

// ── Props ──────────────────────────────────────────────────────
interface TaskSheetProps {
  /** 是否显示面板 */
  open: boolean;
  /** 模式：新建 / 编辑 */
  mode: "create" | "edit";
  /** 新建模式下预填的状态列 ID */
  stateId?: string;
  /** 编辑模式下的目标任务 */
  task?: BoardTask;
  /** 关闭面板的回调 */
  onClose: () => void;
}

/**
 * 任务创建/编辑面板（受控模态框）。
 * 父组件控制显示/隐藏，通过 onClose 关闭；保存后自动关闭。
 */
export function TaskSheet({ open, mode, stateId, task, onClose }: TaskSheetProps) {
  const states = useBoardStore((s) => s.states);
  const labels = useBoardStore((s) => s.labels);
  const openedProjectId = useBoardStore((s) => s.openedProjectId);
  const createTask = useBoardStore((s) => s.createTask);
  const updateTask = useBoardStore((s) => s.updateTask);

  // ── 表单状态 ──────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [state, setState] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // ── 初始化 / 重置：当 open / task / mode 变化时同步表单 ────
  useEffect(() => {
    if (!open) return;
    setError(undefined);
    if (mode === "edit" && task) {
      // 编辑模式：从目标任务初始化受控输入
      setTitle(task.title);
      setDescription(task.description ?? "");
      setState(task.state);
      setPriority(task.priority);
      setSelectedLabels(task.labels ?? []);
      setDueDate(task.due_date ?? "");
    } else {
      // 新建模式：默认状态列取 stateId，回退到首个状态列
      setTitle("");
      setDescription("");
      setState(stateId ?? states[0]?.id ?? "");
      setPriority("none");
      setSelectedLabels([]);
      setDueDate("");
    }
  }, [open, mode, task, stateId, states]);

  // ── 切换标签选中态 ────────────────────────────────────────
  function toggleLabel(id: string) {
    setSelectedLabels((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // ── 标题非空校验（用于禁用保存按钮） ─────────────────────
  const canSave = title.trim().length > 0 && !saving;

  // ── 提交处理 ──────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("任务标题不能为空");
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      if (mode === "edit" && task) {
        // 编辑模式：仅提交变更字段的补丁
        await updateTask(task.id, {
          title: title.trim(),
          description: description.trim() || undefined,
          state,
          priority,
          labels: selectedLabels,
          due_date: dueDate || undefined,
        });
      } else {
        // 新建模式：project 取自当前打开的项目
        if (!openedProjectId) {
          setError("尚未打开任何项目");
          setSaving(false);
          return;
        }
        await createTask({
          project: openedProjectId,
          state,
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          labels: selectedLabels,
          due_date: dueDate || undefined,
        });
      }
      onClose();
    } catch (err) {
      // 保存抛错时展示错误信息（store 内部错误也会同步到 store.error）
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // ── 点击遮罩层关闭（仅在非保存中） ──────────────────────
  function handleBackdropClick() {
    if (!saving) onClose();
  }

  // 未打开则不渲染
  if (!open) return null;

  // ── 渲染 ──────────────────────────────────────────────────
  return (
    /* 遮罩层 */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-sheet-title"
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
            id="task-sheet-title"
            className="text-base font-semibold text-foreground"
          >
            {mode === "edit" ? "编辑任务" : "新建任务"}
          </h2>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            ✕
          </button>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* 标题（必填） */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="ts-title"
              className="text-sm font-medium text-foreground"
            >
              标题
              <span className="ml-1 text-destructive">*</span>
            </label>
            <input
              id="ts-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入任务标题"
              disabled={saving}
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
              htmlFor="ts-desc"
              className="text-sm font-medium text-foreground"
            >
              描述
              <span className="ml-1 text-xs text-muted-foreground">（可选）</span>
            </label>
            <textarea
              id="ts-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="补充任务细节"
              rows={3}
              disabled={saving}
              className={[
                "resize-none rounded-md border border-input bg-background px-3 py-2",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50",
              ].join(" ")}
            />
          </div>

          {/* 状态列选择 */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="ts-state"
              className="text-sm font-medium text-foreground"
            >
              状态
            </label>
            <select
              id="ts-state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              disabled={saving}
              className={[
                "rounded-md border border-input bg-background px-3 py-2",
                "text-sm text-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50",
              ].join(" ")}
            >
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* 优先级选择 */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="ts-priority"
              className="text-sm font-medium text-foreground"
            >
              优先级
            </label>
            <select
              id="ts-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              disabled={saving}
              className={[
                "rounded-md border border-input bg-background px-3 py-2",
                "text-sm text-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50",
              ].join(" ")}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* 标签多选（芯片按标签自身颜色着色） */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">
              标签
              <span className="ml-1 text-xs text-muted-foreground">（可选）</span>
            </span>
            {labels.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无可用标签</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {labels.map((l) => {
                  const active = selectedLabels.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={active}
                      disabled={saving}
                      onClick={() => toggleLabel(l.id)}
                      className={[
                        "flex items-center gap-1.5 rounded-full border px-3 py-1",
                        "text-xs font-medium",
                        "focus:outline-none focus:ring-2 focus:ring-ring",
                        "disabled:opacity-50",
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      ].join(" ")}
                    >
                      {/* 颜色点：用户数据颜色，允许内联 style */}
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: l.color }}
                      />
                      {l.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 截止日期（可选） */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="ts-due"
              className="text-sm font-medium text-foreground"
            >
              截止日期
              <span className="ml-1 text-xs text-muted-foreground">（可选）</span>
            </label>
            <input
              id="ts-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={saving}
              className={[
                "rounded-md border border-input bg-background px-3 py-2",
                "text-sm text-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50",
              ].join(" ")}
            />
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
              disabled={saving}
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
              disabled={!canSave}
              className={[
                "rounded-md bg-primary px-4 py-2 text-sm font-medium",
                "text-primary-foreground shadow-sm",
                "hover:bg-primary/90",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50",
              ].join(" ")}
            >
              {saving ? "保存中…" : mode === "edit" ? "保存" : "创建"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
