// 退出行为设置：托盘「退出」时如何处理受管 headless 进程。
// keep=保留后台（默认，下次继续管理）/ kill=全部结束 / ask=每次询问。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ipc } from "@/lib/tauri/ipc";

type Behavior = "keep" | "kill" | "ask";

function isBehavior(v: string): v is Behavior {
  return v === "keep" || v === "kill" || v === "ask";
}

export function ProcessExitSection() {
  const { t } = useTranslation("settings");
  const [value, setValue] = useState<Behavior>("keep");

  // 挂载时读取当前设置
  useEffect(() => {
    void ipc.getExitBehavior().then((v) => {
      if (isBehavior(v)) setValue(v);
    });
  }, []);

  const apply = async (next: Behavior) => {
    setValue(next);
    try {
      await ipc.setExitBehavior(next);
    } catch (e) {
      toast.error(t("processExit.error", { msg: String(e) }));
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("processExit.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("processExit.desc")}</p>
      </div>
      <Select value={value} onValueChange={(v) => void apply(v as Behavior)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="keep">{t("processExit.keep")}</SelectItem>
          <SelectItem value="kill">{t("processExit.kill")}</SelectItem>
          <SelectItem value="ask">{t("processExit.ask")}</SelectItem>
        </SelectContent>
      </Select>
    </section>
  );
}
