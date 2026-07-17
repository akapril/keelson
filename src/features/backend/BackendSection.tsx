// 设置页「后端」区：配置远程 PocketBase URL（多设备）。空=用本地内置 sidecar。
// 修改后需重载应用生效（PB 客户端在启动时绑定 baseURL）。
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getRemotePbUrl, setRemotePbUrl } from "@/lib/pb";
import { ipc } from "@/lib/tauri/ipc";

export function BackendSection() {
  const [url, setUrl] = useState(getRemotePbUrl());
  const current = getRemotePbUrl();

  const apply = (value: string) => {
    setRemotePbUrl(value);
    toast.success(value ? "已切换到远程 PocketBase，即将重载…" : "已切回本地，即将重载…");
    setTimeout(() => window.location.reload(), 800);
  };

  // 打开本地 PocketBase 数据目录（pb_data）
  const openDataDir = async () => {
    try {
      const dir = await ipc.pbDataDir();
      await ipc.openPath(dir);
    } catch (e) {
      toast.error(`打开数据目录失败：${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">后端 / 远程 PocketBase</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          默认使用本地内置 PocketBase（免登录）。填写远程地址后将连接远程并要求邮箱/密码登录，
          实现多设备共享。修改后需重载应用生效。
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pb-url">远程 PocketBase 地址</Label>
        <div className="flex items-center gap-2">
          <Input
            id="pb-url"
            type="text"
            value={url}
            placeholder="https://pb.example.com（留空用本地）"
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1"
          />
          <Button size="sm" onClick={() => apply(url)} disabled={url.trim() === current}>
            应用并重载
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        当前：
        {current ? (
          <span className="ml-1 font-mono text-foreground">{current}</span>
        ) : (
          <span className="ml-1">本地内置</span>
        )}
        {current && (
          <button
            type="button"
            onClick={() => apply("")}
            className="ml-3 text-primary hover:underline"
          >
            切回本地
          </button>
        )}
      </p>

      <p className="text-[11px] text-muted-foreground">
        注意（最小版）：会话元数据同步仍写入本地 PB；看板 / 文档 / 阅读 / 日历 / 通知等数据走所选后端。
      </p>

      {/* 本地数据目录：只读定位，方便备份/排障（不做迁移，避免停服搬数据的复杂度） */}
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">本地数据目录（pb_data）</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void openDataDir()}>
          打开数据目录
        </Button>
      </div>
    </section>
  );
}
