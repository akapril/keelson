import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "../../lib/tauri/ipc";

// ── 类型：git_info 命令返回结构（镜像 Rust GitInfo） ──────────
interface GitInfo {
  branch: string | null;
  dirty_count: number;
  is_repo: boolean;
}

// ── Props ──────────────────────────────────────────────────
interface GitStatusBarProps {
  /** 项目对应的本地仓库路径（board_projects.repo_path） */
  repoPath: string;
}

/**
 * 紧凑的 git 状态条：展示当前分支与未提交变更数。
 * - 挂载时调用 ipc.gitInfo；加载中显示占位；
 * - 非仓库（!is_repo）或出错时不渲染任何内容（返回 null）。
 */
export function GitStatusBar({ repoPath }: GitStatusBarProps) {
  const { t } = useTranslation("board");
  // info === undefined 表示尚未加载完成；null 表示不应渲染（非仓库/出错）
  const [info, setInfo] = useState<GitInfo | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    // 每次 repoPath 变化时重新查询，先回到加载态
    setInfo(undefined);
    ipc
      .gitInfo(repoPath)
      .then((result) => {
        if (cancelled) return;
        // 非仓库直接置为 null（不渲染）
        setInfo(result.is_repo ? result : null);
      })
      .catch(() => {
        // 出错时静默隐藏
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  // 加载中：低调占位
  if (info === undefined) {
    return (
      <div className="h-5 w-32 animate-pulse rounded bg-muted" aria-hidden="true" />
    );
  }

  // 非仓库 / 出错：不渲染
  if (info === null) return null;

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      {/* ⎇ 分支名 · N 未提交 */}
      <span className="font-mono">⎇ {info.branch ?? "(detached)"}</span>
      <span>·</span>
      <span>{t("git.uncommitted", { count: info.dirty_count })}</span>
    </div>
  );
}
