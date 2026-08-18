// 收藏行「⋯」下拉菜单：把低频/多分支操作收进面板，避免行上堆图标。
// 固定项目以「接续」为主：继续会话(逐条接续) / 新建终端(纯终端, 自己敲 CLI) / 打开项目·目录·取消收藏。
// 悬停露出、点击展开（由 app-sidebar 的行控制可见性）；纯前端，失败均 toast。
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoreHorizontalIcon,
  ArrowRight01Icon,
  FolderOpenIcon,
  TerminalIcon,
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
import { providerLabel } from "@/lib/providers";
import { ipc } from "@/lib/tauri/ipc";
import type { Session } from "@/types/session";

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
  // 打开目录：系统文件管理器打开仓库目录。
  const handleOpenDir = () => {
    if (!repoPath) return;
    void ipc
      .openPath(repoPath)
      .catch((e) => toast.error(t("project.toast.openDirError", { msg: String(e) })));
  };
  // 打开终端：在项目目录起一个纯终端（不跑 CLI）。
  const handleOpenTerminal = () => {
    if (!repoPath) return;
    void ipc
      .openTerminal(repoPath)
      .catch((e) => toast.error(t("project.toast.openTerminalError", { msg: String(e) })));
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

        {/* 项目级操作（固定项目以接续为主；要新起自己在纯终端敲 CLI） */}
        <DropdownMenuSeparator />
        {/* from=fav：与收藏行点击保持一致——浏览进入，返回回项目列表而非浏览器后退 */}
        <DropdownMenuItem onClick={() => navigate(`/board?open=${projectId}&from=fav`)} className="gap-2">
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5 shrink-0" />
          <span>{t("project.ctxMenu.open")}</span>
        </DropdownMenuItem>
        {repoPath && (
          <DropdownMenuItem onClick={handleOpenTerminal} className="gap-2">
            <HugeiconsIcon icon={TerminalIcon} strokeWidth={2} className="size-3.5 shrink-0" />
            <span>{t("project.favMenu.newTerminalLabel")}</span>
          </DropdownMenuItem>
        )}
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
