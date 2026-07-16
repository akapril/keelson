// 从阅读条目建任务对话框：预填标题（来自阅读条目标题），
// 选择目标看板项目（默认取第一个项目），
// 提交时解析该项目首个状态列，调用 createTask 落入首列。
// 注意：不写入 source_session_id（该溯源字段仅用于会话来源）。
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useBoardStore } from "@/store/board";
import type { ReadingItem } from "@/types/reading";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Props ──────────────────────────────────────────────────────
interface CreateTaskFromReadingDialogProps {
  /** 来源阅读条目 */
  item: ReadingItem;
  /** 关闭对话框的回调 */
  onClose: () => void;
}

/**
 * 从阅读条目创建看板任务的对话框（受控模态框）。
 * 默认目标项目：项目列表中的第一个看板项目（若存在）。
 */
export function CreateTaskFromReadingDialog({
  item,
  onClose,
}: CreateTaskFromReadingDialogProps) {
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

  // ── 默认项目：取第一个看板项目 ─────────────────────────────
  const defaultProjectId = useMemo(() => projects[0]?.id ?? "", [projects]);

  // ── 表单状态 ──────────────────────────────────────────────
  const [title, setTitle] = useState(item.title);
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
      setError("请先在「项目」中创建一个看板项目");
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
      // 描述由链接 + 备注拼接（各自有值时才纳入）
      const description = [item.url, item.note].filter(Boolean).join("\n\n");
      // 创建任务（不写入会话溯源字段）
      await useBoardStore.getState().createTask({
        project: projectId,
        state: firstState.id,
        title: title.trim(),
        description,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  // ── 渲染 ──────────────────────────────────────────────────
  return (
    // 受控 Dialog：仅在非加载状态下允许关闭
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !loading) onClose();
      }}
    >
      <DialogContent>
        {/* 标题区 */}
        <DialogHeader>
          <DialogTitle>从阅读条目建任务</DialogTitle>
        </DialogHeader>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* 任务标题（必填，预填自阅读条目标题） */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ctr-title">
              标题
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input
              id="ctr-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入任务标题"
              disabled={loading}
            />
          </div>

          {/* 目标项目选择 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ctr-project">
              目标项目
              <span className="ml-1 text-destructive">*</span>
            </Label>
            {projects.length === 0 ? (
              // 无看板项目时提示先创建项目
              <p className="text-sm text-muted-foreground">
                请先在「项目」中创建一个看板项目
              </p>
            ) : (
              <Select
                value={projectId}
                onValueChange={setProjectId}
                disabled={loading}
              >
                <SelectTrigger id="ctr-project" className="w-full">
                  <SelectValue placeholder="选择目标项目" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* 来源链接（只读展示，仅在有值时） */}
          {item.url && (
            <p className="truncate text-xs text-muted-foreground">
              来源链接：
              <span className="ml-1 font-mono">{item.url}</span>
            </p>
          )}

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
          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              取消
            </Button>
            <Button type="submit" disabled={loading || projects.length === 0}>
              {loading ? "创建中…" : "创建任务"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
