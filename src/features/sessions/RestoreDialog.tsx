import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRestoreStore } from "../../store/restore";
import type { Session } from "../../types/session";

// ── Props ──────────────────────────────────────────────────
interface RestoreDialogProps {
  /** 要恢复的会话；为 null 时对话框关闭 */
  session: Session | null;
  /** 关闭对话框的回调 */
  onClose: () => void;
}

/**
 * 恢复会话对话框。
 * 提供两种恢复方式：
 *   1. "恢复到新终端窗" (asTab=false) —— 打开独立终端窗口
 *   2. "作为标签页" (asTab=true)     —— 在终端标签页中打开
 *
 * 调用 useRestoreStore.restore(session, asTab) 触发后端 terminal_resume。
 * 成功后自动关闭对话框；失败则在对话框内展示错误信息。
 */
export function RestoreDialog({ session, onClose }: RestoreDialogProps) {
  const { t } = useTranslation("sessions");
  const restore = useRestoreStore((s) => s.restore);
  const loading = useRestoreStore((s) => s.loading);
  const error = useRestoreStore((s) => s.error);
  const clearError = useRestoreStore((s) => s.clearError);

  // 当对话框切换到不同的 session 时，清除上一次的错误信息，
  // 避免旧的"恢复失败"错误在新 session 打开时残留显示。
  useEffect(() => {
    clearError();
  }, [session?.session_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 点击遮罩层关闭对话框（加载中禁止关闭）
  function handleOverlayClick() {
    if (!loading) onClose();
  }

  // 阻止对话框内部点击冒泡到遮罩层
  function handleDialogClick(e: React.MouseEvent) {
    e.stopPropagation();
  }

  // ESC 键关闭对话框
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) onClose();
    }
    if (session) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [session, loading, onClose]);

  // 执行恢复操作并在成功后关闭
  async function handleRestore(asTab: boolean) {
    if (!session || loading) return;
    await restore(session, asTab);
    // 仅当无错误时关闭（检查 store 中是否有错误）
    // 因为 restore 是异步的，用 store 的 error 来判断
    const currentError = useRestoreStore.getState().error;
    if (!currentError) {
      onClose();
    }
  }

  // 对话框未激活时不渲染
  if (!session) return null;

  return (
    // 全屏遮罩层，点击可关闭
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      {/* 对话框主体 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-dialog-title"
        className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-xl"
        onClick={handleDialogClick}
      >
        {/* 标题区 */}
        <h2
          id="restore-dialog-title"
          className="mb-1 text-base font-semibold text-foreground"
        >
          {t("restore.title")}
        </h2>

        {/* 会话信息摘要 */}
        <p className="mb-4 truncate text-sm text-muted-foreground" title={session.project_path}>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {session.provider}
          </span>
          {"  "}
          {session.project_name}
        </p>

        {/* 错误提示 */}
        {error && (
          <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t("restore.error", { msg: error })}
          </p>
        )}

        {/* 操作按钮区 */}
        <div className="flex flex-col gap-2">
          {/* 主操作：打开新终端窗口 */}
          <button
            disabled={loading}
            onClick={() => handleRestore(false)}
            className={[
              "w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
              // 主要按钮样式：primary 颜色
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:cursor-not-allowed disabled:opacity-50",
            ].join(" ")}
          >
            {/* 加载中时展示旋转指示器 */}
            {loading ? t("restore.loading") : t("restore.openNewWindow")}
          </button>

          {/* 次操作：作为标签页打开 */}
          <button
            disabled={loading}
            onClick={() => handleRestore(true)}
            className={[
              "w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors",
              // 次要按钮样式：轮廓样式
              "bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground",
              "disabled:cursor-not-allowed disabled:opacity-50",
            ].join(" ")}
          >
            {loading ? t("restore.loading") : t("restore.openAsTab")}
          </button>

          {/* 取消 */}
          <button
            disabled={loading}
            onClick={onClose}
            className={[
              "w-full rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors",
              "hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-50",
            ].join(" ")}
          >
            {t("common:action.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
