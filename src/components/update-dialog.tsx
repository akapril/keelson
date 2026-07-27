// 升级弹窗：发现新版本时弹出，展示版本对比 + markdown 更新日志 + 下载进度安装。
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { useUpdaterStore } from "@/store/updater";

export function UpdateDialog() {
  const { t } = useTranslation("shell");
  const dialogOpen = useUpdaterStore((s) => s.dialogOpen);
  const version = useUpdaterStore((s) => s.version);
  const currentVersion = useUpdaterStore((s) => s.currentVersion);
  const notes = useUpdaterStore((s) => s.notes);
  const installing = useUpdaterStore((s) => s.installing);
  const progress = useUpdaterStore((s) => s.progress);
  const error = useUpdaterStore((s) => s.error);
  const closeDialog = useUpdaterStore((s) => s.closeDialog);
  const install = useUpdaterStore((s) => s.installAndRestart);

  return (
    <Dialog open={dialogOpen} onOpenChange={(o) => !o && !installing && closeDialog()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle>{t("updateDialog.title")}</DialogTitle>
          <DialogDescription>
            {currentVersion
              ? t("updateDialog.descriptionWithCurrent", { version, current: currentVersion })
              : t("updateDialog.descriptionNoCurrent", { version })}
          </DialogDescription>
        </DialogHeader>

        {notes.trim() && (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              {t("updateDialog.changelogLabel")}
            </p>
            <Markdown content={notes} />
          </div>
        )}

        {error && (
          <p className="shrink-0 text-xs text-destructive">
            {t("updateDialog.errorPrefix", { msg: error })}
          </p>
        )}

        <DialogFooter className="items-center">
          {installing && (
            <span className="mr-auto text-xs text-muted-foreground">
              {t("updateDialog.downloading")}
            </span>
          )}
          <Button variant="outline" disabled={installing} onClick={closeDialog}>
            {t("updateDialog.later")}
          </Button>
          <Button disabled={installing} onClick={() => void install()}>
            {installing
              ? t("updateDialog.downloadingProgress", { progress })
              : t("updateDialog.installNow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
