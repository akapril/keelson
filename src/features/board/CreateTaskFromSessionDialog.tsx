// 从会话建任务对话框：预填标题（来自会话最后/首条提示词），
// 选择目标看板项目（默认匹配 repo_path === session.project_path），
// 提交时解析该项目首个状态列，调用 createTask 并写入来源溯源字段。
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useBoardStore } from "@/store/board";
import type { Session } from "@/types/session";
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
  const { t } = useTranslation("board");
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
      setError(t("fromSession.errors.noProject"));
      return;
    }
    if (!title.trim()) {
      setError(t("fromSession.errors.emptyTitle"));
      return;
    }

    setLoading(true);
    try {
      const store = useBoardStore.getState();
      // 打开目标项目以加载其状态列，取首个状态列作为落点
      await store.openProject(projectId);
      const firstState = useBoardStore.getState().states[0];
      if (!firstState) {
        setError(t("fromSession.errors.noStates"));
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
          <DialogTitle>{t("fromSession.title")}</DialogTitle>
        </DialogHeader>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* 任务标题（必填，预填自会话提示词） */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cts-title">
              {t("fromSession.fieldTitle")}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input
              id="cts-title"
              type="text"
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("fromSession.titlePlaceholder")}
              disabled={loading}
            />
          </div>

          {/* 目标项目选择 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cts-project">
              {t("fromSession.fieldProject")}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            {projects.length === 0 ? (
              // 无看板项目时保留"先提升为看板项目"提示
              <p className="text-sm text-muted-foreground">
                {t("fromSession.noProjects")}
              </p>
            ) : (
              <Select
                value={projectId}
                onValueChange={setProjectId}
                disabled={loading}
              >
                <SelectTrigger id="cts-project" className="w-full">
                  <SelectValue placeholder={t("fromSession.projectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.repo_path === session.project_path
                        ? t("fromSession.repoMatch")
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* 来源会话信息（只读展示） */}
          <p className="text-xs text-muted-foreground">
            {t("fromSession.sourceLabel")}
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
          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              {t("common:action.cancel")}
            </Button>
            <Button type="submit" disabled={loading || projects.length === 0}>
              {loading ? t("fromSession.creating") : t("fromSession.createBtn")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
