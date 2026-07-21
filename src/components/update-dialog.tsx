// 升级弹窗：发现新版本时弹出，展示版本对比 + markdown 更新日志 + 下载进度安装。
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
          <DialogTitle>发现新版本</DialogTitle>
          <DialogDescription>
            rework {version} 已发布
            {currentVersion ? `，当前版本为 ${currentVersion}` : ""}。
          </DialogDescription>
        </DialogHeader>

        {notes.trim() && (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">更新内容</p>
            <Markdown content={notes} />
          </div>
        )}

        {error && <p className="shrink-0 text-xs text-destructive">更新失败：{error}</p>}

        <DialogFooter className="items-center">
          {installing && (
            <span className="mr-auto text-xs text-muted-foreground">
              下载中…请勿关闭
            </span>
          )}
          <Button variant="outline" disabled={installing} onClick={closeDialog}>
            稍后
          </Button>
          <Button disabled={installing} onClick={() => void install()}>
            {installing ? `下载中 ${progress}%` : "下载并安装"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
