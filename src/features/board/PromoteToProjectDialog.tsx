// 提升为看板项目对话框：将会话中枢里的某个 project_path 提升为受管的看板项目。
// 预填名称（路径末段）+ 只读仓库路径，用户选择模板后调用 store.createProject，
// 成功后打开该项目并跳转到看板路由。组件不直接调用 invoke / pb.collection，一律走 store。
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useBoardStore } from "../../store/board";
import { workspaceRecordUrl } from "../../lib/workspace-navigation";
// ── shadcn/ui 基础组件 ──────────────────────────────────────────
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
  const projects = useBoardStore((s) => s.projects);
  const navigate = useNavigate();

  // 防重：同一仓库路径已有「进行中」项目 → 不允许重复提升（一仓库一项目），引导打开已有。
  // 归档项目不算（可能已弃用，允许重新提升）。
  const existing = projects.find(
    (p) => (p.repo_path ?? "") === projectPath && !p.archived,
  );

  // 打开已有项目并跳转
  async function openExisting(id: string) {
    await useBoardStore.getState().openProject(id);
    navigate(workspaceRecordUrl("board", id));
    onClose();
  }

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

  // ── 渲染 ──────────────────────────────────────────────────
  return (
    // 使用 shadcn/ui Dialog：外部持续 open，关闭时（且非加载中）回调 onClose
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !loading) onClose();
      }}
    >
      <DialogContent aria-labelledby="promote-project-title">
        {/* 标题区 */}
        <DialogHeader>
          <DialogTitle id="promote-project-title">提升为看板项目</DialogTitle>
        </DialogHeader>

        {existing ? (
          /* 该仓库已提升 → 不允许重复提升，引导打开已有项目 */
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="text-foreground">
                此仓库已提升为项目「
                <span className="font-medium">{existing.name}</span>」。
              </p>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                {projectPath}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                一个仓库对应一个项目，避免重复。会话仍会关联到该项目。
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button type="button" onClick={() => void openExisting(existing.id)}>
                打开「{existing.name}」
              </Button>
            </DialogFooter>
          </div>
        ) : (
        /* 表单 */
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* 项目名称（必填，预填路径末段） */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pp-name">
              项目名称
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="pp-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入项目名称"
              disabled={loading}
            />
          </div>

          {/* 仓库路径（只读，固定为会话项目路径） */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pp-repo">
              仓库路径
              <span className="text-xs font-normal text-muted-foreground">
                （来自会话项目）
              </span>
            </Label>
            <Input
              id="pp-repo"
              type="text"
              readOnly
              value={projectPath}
              title={projectPath}
              // 只读态：静音背景 + 静音文本，避免被误认为可编辑
              className="cursor-default bg-muted text-muted-foreground focus-visible:ring-0"
            />
          </div>

          {/* 模板选择 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pp-template">
              模板
              <span className="text-destructive">*</span>
            </Label>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">加载模板中…</p>
            ) : (
              <Select
                value={templateId}
                onValueChange={setTemplateId}
                disabled={loading}
              >
                <SelectTrigger id="pp-template" className="w-full">
                  <SelectValue placeholder="选择模板" />
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              取消
            </Button>
            <Button type="submit" disabled={loading || templates.length === 0}>
              {loading ? "提升中…" : "提升"}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
