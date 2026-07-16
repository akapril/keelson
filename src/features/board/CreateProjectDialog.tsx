// 新建项目对话框：收集名称 / 描述 / 仓库路径 + 模板选择，
// 调用 createProjectFromTemplate，成功后刷新项目列表并关闭。
// 表现层已改用 shadcn/ui Dialog 及输入类原语，逻辑保持不变。
import { useState, type FormEvent } from "react";
import { useBoardStore } from "../../store/board";
import { createProjectFromTemplate } from "./create-project";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

  // ── 渲染 ──────────────────────────────────────────────────
  return (
    <Dialog
      open
      // Dialog 的开/关由 Radix 统一管理：关闭时（点击遮罩 / Esc / 关闭按钮）
      // 且非加载状态才回调 onClose，等价于原来的遮罩点击守卫。
      onOpenChange={(o) => {
        if (!o && !loading) onClose();
      }}
    >
      <DialogContent>
        {/* 标题区 */}
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            填写项目信息并选择一个模板以创建。
          </DialogDescription>
        </DialogHeader>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* 项目名称（必填） */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-name">
              项目名称
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input
              id="cp-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入项目名称"
              disabled={loading}
            />
          </div>

          {/* 描述（可选） */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-desc">
              描述
              <span className="ml-1 text-xs text-muted-foreground">（可选）</span>
            </Label>
            <Textarea
              id="cp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简短描述项目用途"
              rows={2}
              disabled={loading}
            />
          </div>

          {/* 仓库路径（可选） */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-repo">
              仓库路径
              <span className="ml-1 text-xs text-muted-foreground">（可选）</span>
            </Label>
            <Input
              id="cp-repo"
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="/path/to/repo 或留空"
              disabled={loading}
            />
          </div>

          {/* 模板选择 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-template">
              模板
              <span className="ml-1 text-destructive">*</span>
            </Label>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无可用模板</p>
            ) : (
              <Select
                value={templateId}
                onValueChange={setTemplateId}
                disabled={loading}
              >
                {/* 触发器铺满一行，覆盖默认的 w-fit */}
                <SelectTrigger id="cp-template" className="w-full">
                  <SelectValue placeholder="选择一个模板" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.description ? ` — ${t.description}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              取消
            </Button>
            <Button type="submit" disabled={loading || templates.length === 0}>
              {loading ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
