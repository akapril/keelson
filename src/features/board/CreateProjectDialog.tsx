// 新建项目对话框：收集名称 / 描述 / 仓库路径 + 模板选择，
// 调用 createProjectFromTemplate，成功后刷新项目列表并关闭。
// 表现层已改用 shadcn/ui Dialog 及输入类原语，逻辑保持不变。
import { useState, useMemo, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { FolderOpenIcon } from "@hugeicons/core-free-icons";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BoardTemplate } from "../../types/board";

// 分组展示顺序（未列出的类别排在已知之后、「其他」最末）
const CATEGORY_ORDER = ["开发", "职场管理", "内容营销", "研究", "个人生活", "商业创业", "通用"];

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
  const projects = useBoardStore((s) => s.projects);

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

  // 按 category 分组（用于选择器分组展示）
  const grouped = useMemo(() => {
    const m = new Map<string, BoardTemplate[]>();
    for (const t of templates) {
      const c = t.category || "其他";
      const arr = m.get(c);
      if (arr) arr.push(t);
      else m.set(c, [t]);
    }
    const rank = (c: string) => {
      const i = CATEGORY_ORDER.indexOf(c);
      return i === -1 ? (c === "其他" ? 999 : 500) : i;
    };
    return [...m.keys()].sort((a, b) => rank(a) - rank(b)).map((k) => [k, m.get(k)!] as const);
  }, [templates]);

  // 当前选中的模板（用于预览）
  const selected = templates.find((t) => t.id === templateId);

  // 打开原生目录选择器，选中后填入仓库路径
  async function pickRepoDir() {
    try {
      const dir = await open({
        directory: true,
        multiple: false,
        title: "选择项目仓库目录",
      });
      if (typeof dir === "string") setRepoPath(dir);
    } catch {
      // 用户取消或非 Tauri 环境：忽略
    }
  }

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
            {/* 同名提示（不阻止创建，仅提醒用仓库路径区分） */}
            {name.trim() &&
              projects.some(
                (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase(),
              ) && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  已存在同名项目，建议绑定仓库路径以便区分。
                </p>
              )}
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
            <div className="flex items-center gap-2">
              <Input
                id="cp-repo"
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="/path/to/repo 或留空"
                disabled={loading}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void pickRepoDir()}
                disabled={loading}
                title="选择本地目录"
              >
                <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
                浏览
              </Button>
            </div>
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
                  {grouped.map(([cat, list]) => (
                    <SelectGroup key={cat}>
                      <SelectLabel>{cat}</SelectLabel>
                      {list.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* 所选模板预览：描述 + 状态列胶囊 + 标签/起步任务/起始文档概览 */}
            {selected && (
              <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
                {selected.description && (
                  <p className="text-muted-foreground">{selected.description}</p>
                )}
                <div className="flex flex-wrap gap-1">
                  {selected.states.map((s) => (
                    <span
                      key={s.name}
                      className="inline-flex items-center gap-1 rounded-full bg-card px-1.5 py-0.5 text-foreground"
                    >
                      <span className="size-1.5 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                  {selected.labels && selected.labels.length > 0 && (
                    <span>标签 {selected.labels.length}</span>
                  )}
                  {selected.tasks && selected.tasks.length > 0 && (
                    <span>起步任务 {selected.tasks.length}</span>
                  )}
                  {selected.starter_docs && selected.starter_docs.length > 0 && (
                    <span>起始文档：{selected.starter_docs.map((d) => d.title).join("、")}</span>
                  )}
                </div>
              </div>
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
