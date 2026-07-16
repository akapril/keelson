// 设置页「软件更新」区：手动检查 + 状态展示 + 一键安装重启。
// 自启动会静默检查；此处提供手动入口与可见状态/错误。
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUpdaterStore } from "@/store/updater";

export function UpdateSection() {
  const { available, version, notes, checking, installing, error } =
    useUpdaterStore();

  const check = () => void useUpdaterStore.getState().checkForUpdate();

  const install = async () => {
    toast.loading("正在下载并安装更新…", { id: "app-update" });
    await useUpdaterStore.getState().installAndRestart();
    toast.error(
      `更新失败：${useUpdaterStore.getState().error ?? "未知错误"}`,
      { id: "app-update" },
    );
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">软件更新</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          启动时会自动检查更新；发现新版本时头部会显示红点提示。也可在此手动检查。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" disabled={checking || installing} onClick={check}>
          {checking ? "检查中…" : "检查更新"}
        </Button>
        {available && (
          <Button size="sm" disabled={installing} onClick={() => void install()}>
            {installing ? "安装中…" : `下载 v${version} 并重启`}
          </Button>
        )}
      </div>

      {/* 状态 / 错误 */}
      {available ? (
        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          <p className="text-foreground">发现新版本 v{version}</p>
          {notes && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
              {notes}
            </p>
          )}
        </div>
      ) : (
        !checking &&
        !error && (
          <p className="text-xs text-muted-foreground">已是最新版本（或更新源未配置）。</p>
        )
      )}
      {error && <p className="text-xs text-destructive">检查失败：{error}</p>}
    </section>
  );
}
