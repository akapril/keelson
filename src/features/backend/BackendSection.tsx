// 设置页「后端」区：配置远程 PocketBase URL（多设备）。空=用本地内置 sidecar。
// 修改后需重载应用生效（PB 客户端在启动时绑定 baseURL）。
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getRemotePbUrl, setRemotePbUrl } from "@/lib/pb";
import { ipc } from "@/lib/tauri/ipc";

export function BackendSection() {
  const { t } = useTranslation("settings");
  const [url, setUrl] = useState(getRemotePbUrl());
  const current = getRemotePbUrl();

  const apply = (value: string) => {
    setRemotePbUrl(value);
    toast.success(value ? t("backend.toast.switchRemote") : t("backend.toast.switchLocal"));
    setTimeout(() => window.location.reload(), 800);
  };

  // 打开本地 PocketBase 数据目录（pb_data）
  const openDataDir = async () => {
    try {
      const dir = await ipc.pbDataDir();
      await ipc.openPath(dir);
    } catch (e) {
      toast.error(t("backend.toast.openDirError", { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("backend.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("backend.desc")}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pb-url">{t("backend.urlLabel")}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="pb-url"
            type="text"
            value={url}
            placeholder={t("backend.urlPlaceholder")}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1"
          />
          <Button size="sm" onClick={() => apply(url)} disabled={url.trim() === current}>
            {t("backend.applyBtn")}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("backend.currentLabel")}
        {current ? (
          <span className="ml-1 font-mono text-foreground">{current}</span>
        ) : (
          <span className="ml-1">{t("backend.localLabel")}</span>
        )}
        {current && (
          <button
            type="button"
            onClick={() => apply("")}
            className="ml-3 text-primary hover:underline"
          >
            {t("backend.switchLocalBtn")}
          </button>
        )}
      </p>

      <p className="text-[11px] text-muted-foreground">
        {t("backend.note")}
      </p>

      {/* 本地数据目录：只读定位，方便备份/排障（不做迁移，避免停服搬数据的复杂度） */}
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">{t("backend.dataDir")}</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void openDataDir()}>
          {t("backend.openDirBtn")}
        </Button>
      </div>
    </section>
  );
}
