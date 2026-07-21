// 任务创建/编辑面板：右侧滑出 Sheet（受控）。
// UX 参照 workavera 的 todo-card-sheet，但去除 assignees / 关联文档 / 活动记录；数据一律走 useBoardStore。
// 本组件不直接调用 invoke 或 pb.collection。
import { useEffect, useState } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, AiChat02Icon } from "@hugeicons/core-free-icons";
import { TaskBreakdownDialog } from "./TaskBreakdownDialog";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
import { PRIORITY_META, PRIORITY_ORDER } from "@/features/board/board-meta";
import { useBoardStore } from "@/store/board";
import type { BoardTask, TaskPriority } from "@/types/board";

// ── Props（KanbanBoard 已依赖，保持不变） ────────────────────
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
 * 任务创建/编辑面板：右侧滑出 Sheet。
 * 父组件通过 open 控制显隐；关闭（onOpenChange → false）或保存成功后调用 onClose。
 */
export function TaskSheet({ open, mode, stateId, task, onClose }: TaskSheetProps) {
  const states = useBoardStore((s) => s.states);
  const labels = useBoardStore((s) => s.labels);

  // ── 表单状态（受控输入） ──────────────────────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [state, setState] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 控制「AI 拆解」对话框
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  // 描述的「预览(markdown) / 编辑」切换
  const [descPreview, setDescPreview] = useState(false);

  // ── 初始化 / 重置：随 open / task / mode 同步表单字段 ──────
  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setConfirmDelete(false);
    setDescPreview(false);
    if (mode === "edit" && task) {
      // 编辑模式：从目标任务回填受控输入
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

  // ── 标题非空 + 非保存中 → 允许保存 ───────────────────────
  const canSave = title.trim().length > 0 && !saving;

  // ── 提交（新建 / 编辑），错误内联展示 ───────────────────
  async function handleSave() {
    if (!title.trim()) {
      setError("任务标题不能为空");
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      if (mode === "edit" && task) {
        // 编辑模式：提交变更字段补丁
        await useBoardStore.getState().updateTask(task.id, {
          title: title.trim(),
          description: description.trim() || undefined,
          state,
          priority,
          labels: selectedLabels,
          due_date: dueDate || undefined,
        });
      } else {
        // 新建模式：project 取自当前打开的项目（守卫非空）
        const openedProjectId = useBoardStore.getState().openedProjectId;
        if (!openedProjectId) {
          setError("尚未打开任何项目");
          setSaving(false);
          return;
        }
        await useBoardStore.getState().createTask({
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
      // 保存抛错时内联展示错误信息
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // ── 删除（仅编辑模式），确认后执行 ───────────────────────
  async function handleDelete() {
    if (!task) return;
    setError(undefined);
    setSaving(true);
    try {
      await useBoardStore.getState().deleteTask(task.id);
      setConfirmDelete(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // ── Sheet 关闭回调：关闭时（非保存中）透传给父组件 ──────
  function handleOpenChange(next: boolean) {
    if (!next && !saving) onClose();
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
        {/* 头部标题 */}
        <SheetHeader className="border-b border-border">
          <SheetTitle>{mode === "edit" ? "编辑任务" : "新建任务"}</SheetTitle>
        </SheetHeader>

        {/* 表单主体（可滚动） */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
          {/* 标题（必填） */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="ts-title">
              标题
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ts-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入任务标题"
              disabled={saving}
            />
          </div>

          {/* 描述（可选，支持 markdown；可切换预览） */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="ts-desc">描述</Label>
              {description.trim() && (
                <button
                  type="button"
                  onClick={() => setDescPreview((v) => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {descPreview ? "编辑" : "预览"}
                </button>
              )}
            </div>
            {descPreview ? (
              // 预览：按 markdown 渲染（点「编辑」切回）
              <div className="min-h-24 rounded-md border border-border bg-muted/30 px-3 py-2">
                <Markdown content={description} />
              </div>
            ) : (
              <Textarea
                id="ts-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="补充任务细节（支持 markdown）"
                rows={4}
                disabled={saving}
              />
            )}
            {/* 编辑模式：AI 拆解为子任务 */}
            {mode === "edit" && task && (
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={saving}
                onClick={() => setBreakdownOpen(true)}
                className="self-start"
              >
                <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} />
                AI 拆解为子任务
              </Button>
            )}
          </div>

          {/* 状态 + 优先级（两列） */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label>状态</Label>
              <Select
                value={state}
                onValueChange={setState}
                disabled={saving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择状态" />
                </SelectTrigger>
                <SelectContent>
                  {states.map((st) => (
                    <SelectItem key={st.id} value={st.id}>
                      {/* 状态色点：用户数据颜色，允许内联 style */}
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: st.color }}
                      />
                      {st.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>优先级</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as TaskPriority)}
                disabled={saving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_ORDER.map((p) => (
                    <SelectItem key={p} value={p}>
                      {/* 优先级色点：使用语义/调色类 */}
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          PRIORITY_META[p].dot,
                        )}
                      />
                      {PRIORITY_META[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 标签多选（芯片按标签自身颜色着色） */}
          <div className="flex flex-col gap-2">
            <Label>标签</Label>
            {labels.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无可用标签</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {labels.map((l) => {
                  const active = selectedLabels.includes(l.id);
                  return (
                    <Badge
                      key={l.id}
                      variant={active ? "default" : "outline"}
                      role="button"
                      aria-pressed={active}
                      onClick={() => !saving && toggleLabel(l.id)}
                      className="cursor-pointer border-transparent select-none"
                      // 选中态用标签自身颜色着色（用户数据，允许内联 style）
                      style={
                        active
                          ? { backgroundColor: l.color, color: "#fff" }
                          : undefined
                      }
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{
                          backgroundColor: active
                            ? "rgba(255,255,255,0.6)"
                            : l.color,
                        }}
                      />
                      {l.name}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* 截止日期（可选，使用日历选择器） */}
          <div className="flex flex-col gap-2">
            <Label>截止日期</Label>
            <DatePicker
              value={dueDate}
              onChange={setDueDate}
              placeholder="选择日期"
              disabled={saving}
            />
          </div>

          {/* 错误提示（内联） */}
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        {/* 底部操作栏 */}
        <SheetFooter className="flex-row items-center justify-between border-t border-border">
          {/* 编辑模式：删除入口（destructive） */}
          {mode === "edit" && task ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => setConfirmDelete(true)}
              className="text-destructive hover:text-destructive"
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              删除
            </Button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <Button variant="outline" disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button disabled={!canSave} onClick={() => void handleSave()}>
              {saving ? "保存中…" : mode === "edit" ? "保存" : "创建"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>

      {/* 删除确认对话框 */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除任务？</AlertDialogTitle>
            <AlertDialogDescription>
              将从看板永久移除「{task?.title}」，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AI 拆解为子任务 */}
      <TaskBreakdownDialog
        task={breakdownOpen ? (task ?? null) : null}
        onClose={() => setBreakdownOpen(false)}
      />
    </Sheet>
  );
}
