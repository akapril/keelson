// 收藏行「⋯」下拉菜单：把低频/多分支操作收进面板，避免行上堆图标。
// 内容分三节：继续会话(选具体历史会话) / 新建终端(选 provider) / 打开项目·目录·取消收藏。
// 悬停露出、点击展开（由 app-sidebar 的行控制可见性）；纯前端，失败均 toast。
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoreHorizontalIcon,
  ArrowRight01Icon,
  Add01Icon,
  FolderOpenIcon,
  StarOffIcon,
} from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useBoardStore } from "@/store/board";
import { useRestoreStore } from "@/store/restore";
import { ipc } from "@/lib/tauri/ipc";
import type { Session } from "@/types/session";

// 可新建的 CLI 终端类型（对应 CLAUDE.md / AGENTS.md 两家）。抽成常量便于日后扩展。
const NEW_TERMINAL_PROVIDERS = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
] as const;

// provider 显示名：已知的用固定大小写，未知的首字母大写兜底。
function providerLabel(p: string): string {
  const known = NEW_TERMINAL_PROVIDERS.find((x) => x.id === p);
  return known ? known.label : p.charAt(0).toUpperCase() + p.slice(1);
}

export function FavoriteRowMenu({
  projectId,
  projectName,
  repoPath,
  recentSessions,
  triggerClassName,
}: {
  projectId: string;
  projectName: string;
  /** 项目仓库目录；无则隐藏「新建终端 / 打开目录」两节 */
  repoPath?: string;
  /** 该项目最近若干会话（供「继续会话」逐条接续）；空则隐藏本节 */
  recentSessions: Session[];
  /** ⋯ 触发按钮的样式（由收藏行传入，与行内其它悬停图标一致） */
  triggerClassName?: string;
}) {
  const { t, i18n } = useTranslation("board");
  const navigate = useNavigate();
  const restore = useRestoreStore((s) => s.restore);
  const toggleProjectPin = useBoardStore((s) => s.toggleProjectPin);

  const dfLocale = i18n.language?.startsWith("zh") ? zhCN : enUS;

  // 继续会话：接续指定历史会话（新终端窗，跳过弹窗），失败 toast。
  const handleResumeSession = async (s: Session) => {
    await restore(s, false);
    const err = useRestoreStore.getState().error;
    if (err) toast.error(t("project.toast.resumeError", { msg: err }));
  };
  // 新建终端：在项目目录起一个指定 provider 的新会话。
  const handleNewTerminal = (providerId: string, label: string) => {
    if (!repoPath) return;
    void ipc
      .startSession(providerId, repoPath)
      .then(() => toast.success(t("sessions.toast.startSuccess", { provider: label })))
      .catch((e) => toast.error(t("sessions.toast.startError", { msg: String(e) })));
  };
  // 打开目录：系统文件管理器打开仓库目录。
  const handleOpenDir = () => {
    if (!repoPath) return;
    void ipc
      .openPath(repoPath)
      .catch((e) => toast.error(t("project.toast.openDirError", { msg: String(e) })));
  };
  // 取消收藏：store 写失败重抛→这里 toast（乐观更新已在 store 内回滚）。
  const handleUnpin = () => {
    void toggleProjectPin(projectId).catch((e) =>
      toast.error(t("project.toast.pinError", { msg: String(e) })),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={triggerClassName}
          aria-label={t("project.favMenu.moreTitle")}
          title={t("project.favMenu.moreTitle")}
          onClick={(e) => e.stopPropagation()}
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-60">
        <DropdownMenuLabel className="truncate text-muted-foreground">
          {projectName}
        </DropdownMenuLabel>

        {/* 继续会话：逐条接续，显示 provider + 摘要 + 相对时间 */}
        {recentSessions.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {t("project.favMenu.recentLabel")}
            </DropdownMenuLabel>
            {recentSessions.map((s) => {
              const snippet = (s.last_prompt || s.first_prompt || "").trim();
              return (
                <DropdownMenuItem
                  key={s.session_id}
                  onClick={() => void handleResumeSession(s)}
                  className="gap-2"
                >
                  <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5 shrink-0" />
                  <span className="shrink-0 text-[10px] font-medium uppercase text-muted-foreground">
                    {providerLabel(s.provider)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{snippet || s.project_name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatDistanceToNowStrict(new Date(s.updated_at), { locale: dfLocale })}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </>
        )}

        {/* 新建终端：按 provider 分别起会话 */}
        {repoPath && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {t("project.favMenu.newTerminalLabel")}
            </DropdownMenuLabel>
            {NEW_TERMINAL_PROVIDERS.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => handleNewTerminal(p.id, p.label)}
                className="gap-2"
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-3.5 shrink-0" />
                <span>{p.label}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}

        {/* 项目级操作 */}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate(`/board?open=${projectId}`)} className="gap-2">
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5 shrink-0" />
          <span>{t("project.ctxMenu.open")}</span>
        </DropdownMenuItem>
        {repoPath && (
          <DropdownMenuItem onClick={handleOpenDir} className="gap-2">
            <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} className="size-3.5 shrink-0" />
            <span>{t("project.favMenu.openDir")}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleUnpin} variant="destructive" className="gap-2">
          <HugeiconsIcon icon={StarOffIcon} strokeWidth={2} className="size-3.5 shrink-0" />
          <span>{t("project.ctxMenu.unpin")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
