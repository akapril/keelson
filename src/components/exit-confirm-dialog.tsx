// 退出确认弹窗：当退出行为设为「每次询问」且有运行中受管进程时，
// Rust 托盘退出会 emit("confirm-exit")，此处弹窗让用户选择：全部结束 / 保留后台 / 取消。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { on } from "@/lib/tauri/events";
import { ipc } from "@/lib/tauri/ipc";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ExitConfirmDialog() {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const un = on("confirm-exit", () => setOpen(true));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("exitConfirm.title")}</DialogTitle>
          <DialogDescription>{t("exitConfirm.desc")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {/* 取消：关弹窗不退 */}
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("exitConfirm.cancel")}
          </Button>
          {/* 保留后台：仅退出，进程留存 */}
          <Button variant="outline" onClick={() => void ipc.exitApp(false)}>
            {t("exitConfirm.keep")}
          </Button>
          {/* 全部结束：结束受管进程后退出 */}
          <Button variant="destructive" onClick={() => void ipc.exitApp(true)}>
            {t("exitConfirm.kill")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
