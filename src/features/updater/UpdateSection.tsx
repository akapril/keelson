// 设置页「软件更新」区：手动检查 + 状态展示 + 一键安装重启。
// 自启动会静默检查；此处提供手动入口与可见状态/错误。
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUpdaterStore } from "@/store/updater";

export function UpdateSection() {
  const { t } = useTranslation("settings");
  const { available, version, notes, checking, installing, error } =
    useUpdaterStore();

  const check = () => void useUpdaterStore.getState().checkForUpdate();

  const install = async () => {
    toast.loading(t("updater.toast.loading"), { id: "app-update" });
    await useUpdaterStore.getState().installAndRestart();
    toast.error(
      t("updater.toast.error", { error: useUpdaterStore.getState().error ?? "Unknown error" }),
      { id: "app-update" },
    );
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("updater.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("updater.desc")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" disabled={checking || installing} onClick={check}>
          {checking ? t("updater.checking") : t("updater.checkBtn")}
        </Button>
        {available && (
          <Button size="sm" disabled={installing} onClick={() => void install()}>
            {installing ? t("updater.installing") : t("updater.installBtn", { version })}
          </Button>
        )}
      </div>

      {/* 状态 / 错误 */}
      {available ? (
        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          <p className="text-foreground">{t("updater.newVersion", { version })}</p>
          {notes && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
              {notes}
            </p>
          )}
        </div>
      ) : (
        !checking &&
        !error && (
          <p className="text-xs text-muted-foreground">{t("updater.upToDate")}</p>
        )
      )}
      {error && <p className="text-xs text-destructive">{t("updater.checkError", { error })}</p>}
    </section>
  );
}
