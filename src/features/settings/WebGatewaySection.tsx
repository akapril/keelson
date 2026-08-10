// Web Gateway 设置区：开关 + 配对码展示/轮换 + 已配对设备列表与吊销。
// - 开关（默认关）：开→ web_gateway_start 并显示端口；关→ web_gateway_stop。
// - 配对码：gateway 开启时展示当前码 + 手动轮换按钮。
// - 设备列表：已配对设备（label + paired_at + 吊销）。
// - 不硬编色；文案全走 settings i18n 命名空间；store 操作失败重抛 + toast。
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";

/** 已配对设备信息（脱敏，仅含可公开字段）。 */
interface DeviceInfo {
  id: string;
  label: string;
  paired_at: string;
}

export function WebGatewaySection() {
  const { t } = useTranslation("settings");

  // gateway 是否运行中，及当前端口
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState<number | null>(null);

  // 配对码
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);

  // 已配对设备列表
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);

  // 开关/设备吊销的 busy 标志
  const [toggleBusy, setToggleBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // 改名内联编辑：editingId=正在编辑的设备 id，editValue=输入框值
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  // ── 刷新配对码 ───────────────────────────────────────────────
  const refreshCode = useCallback(async () => {
    setCodeLoading(true);
    try {
      const code = await ipc.webPairingCode();
      setPairingCode(code);
    } catch (e) {
      toast.error(t("webGateway.codeLoadError", { message: String(e) }));
    } finally {
      setCodeLoading(false);
    }
  }, [t]);

  // ── 刷新设备列表 ─────────────────────────────────────────────
  const refreshDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const list = await ipc.webListDevices();
      setDevices(list);
    } catch (e) {
      toast.error(t("webGateway.devicesLoadError", { message: String(e) }));
    } finally {
      setDevicesLoading(false);
    }
  }, [t]);

  // ── 挂载时同步 gateway 状态 ──────────────────────────────────
  useEffect(() => {
    void ipc.webGatewayStatus().then((p) => {
      if (p !== null && p !== undefined) {
        setEnabled(true);
        setPort(p);
        void refreshCode();
        void refreshDevices();
      }
    });
  }, [refreshCode, refreshDevices]);

  // ── 开关 gateway ─────────────────────────────────────────────
  const handleToggle = async () => {
    if (toggleBusy) return;
    setToggleBusy(true);
    try {
      if (enabled) {
        // 关闭 gateway
        await ipc.webGatewayStop();
        setEnabled(false);
        setPort(null);
        setPairingCode(null);
        setDevices([]);
        toast.success(t("webGateway.stoppedToast"));
      } else {
        // 启动 gateway
        const p = await ipc.webGatewayStart();
        setEnabled(true);
        setPort(p);
        toast.success(t("webGateway.startedToast", { port: p }));
        // 并行拉取配对码和设备列表
        await Promise.all([refreshCode(), refreshDevices()]);
      }
    } catch (e) {
      toast.error(t("webGateway.toggleError", { message: String(e) }));
      throw e;
    } finally {
      setToggleBusy(false);
    }
  };

  // ── 手动轮换配对码 ───────────────────────────────────────────
  const handleRegenerate = async () => {
    if (codeLoading) return;
    setCodeLoading(true);
    try {
      const newCode = await ipc.webRegeneratePairingCode();
      setPairingCode(newCode);
      toast.success(t("webGateway.codeRegeneratedToast"));
    } catch (e) {
      // 重抛让 catch 链可感知；同时 toast 告知用户
      toast.error(t("webGateway.codeRegenerateError", { message: String(e) }));
      throw e;
    } finally {
      setCodeLoading(false);
    }
  };

  // ── 吊销设备 ─────────────────────────────────────────────────
  const handleRevoke = async (id: string) => {
    if (revokingId !== null) return;
    setRevokingId(id);
    try {
      await ipc.webRevokeDevice(id);
      toast.success(t("webGateway.revokeSuccess"));
      // 操作后刷新列表
      await refreshDevices();
    } catch (e) {
      toast.error(t("webGateway.revokeError", { message: String(e) }));
      // 重抛，满足「store 写失败重抛」约定
      throw e;
    } finally {
      setRevokingId(null);
    }
  };

  // ── 改名设备 ─────────────────────────────────────────────────
  const startEdit = (id: string, current: string) => {
    setEditingId(id);
    setEditValue(current);
  };
  const handleRename = async () => {
    if (editingId === null) return;
    const name = editValue.trim();
    if (!name) return;
    setRenaming(true);
    try {
      await ipc.webRenameDevice(editingId, name);
      setEditingId(null);
      await refreshDevices();
    } catch (e) {
      toast.error(t("webGateway.renameError", { message: String(e) }));
      throw e;
    } finally {
      setRenaming(false);
    }
  };

  return (
    <section className="space-y-4">
      {/* 区块标题与说明 */}
      <div>
        <h2 className="text-sm font-medium">{t("webGateway.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("webGateway.desc")}
        </p>
      </div>

      {/* 开关行 */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">
            {enabled
              ? t("webGateway.statusOn", { port: port ?? "…" })
              : t("webGateway.statusOff")}
          </span>
          {enabled && (
            <div className="flex flex-col gap-0.5">
              {/* 本机直连地址（安全上下文例外，http 可用） */}
              <span className="text-xs text-muted-foreground">
                {t("webGateway.accessHintLocal")}
              </span>
              {/* 外网访问必须 HTTPS，否则 Secure cookie 被浏览器丢弃导致掉线 */}
              <span className="text-xs text-muted-foreground">
                {t("webGateway.accessHintRemote")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("webGateway.accessHintPort")}
              </span>
            </div>
          )}
        </div>
        <Button
          variant={enabled ? "outline" : "default"}
          size="sm"
          disabled={toggleBusy}
          onClick={() => void handleToggle()}
        >
          {toggleBusy
            ? t("webGateway.toggling")
            : enabled
              ? t("webGateway.stopBtn")
              : t("webGateway.startBtn")}
        </Button>
      </div>

      {/* 配对码区块（仅 gateway 开启时显示） */}
      {enabled && (
        <div className="space-y-2 rounded-md border border-border px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">
              {t("webGateway.pairingCode")}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={codeLoading}
              onClick={() => void handleRegenerate()}
            >
              {codeLoading
                ? t("webGateway.regenerating")
                : t("webGateway.regenerateBtn")}
            </Button>
          </div>

          {/* 配对码展示：等宽字体，方便抄录 */}
          <div className="rounded bg-muted px-3 py-2">
            {codeLoading || pairingCode === null ? (
              <span className="text-xs text-muted-foreground">
                {t("webGateway.codeLoading")}
              </span>
            ) : (
              <code className="break-all font-mono text-xs leading-relaxed select-all">
                {pairingCode}
              </code>
            )}
          </div>

          {/* 配对码二维码：移动端扫码取码，免手输（白底留静默区，便于识别） */}
          {!codeLoading && pairingCode && (
            <div className="flex justify-center">
              <div className="rounded bg-white p-2">
                <QRCodeSVG value={pairingCode} size={120} />
              </div>
            </div>
          )}

          {/* 配对码使用说明 */}
          <p className="text-xs text-muted-foreground">
            {t("webGateway.codeHint")}
          </p>
        </div>
      )}

      {/* 已配对设备列表（仅 gateway 开启且 devices 非空时显示） */}
      {enabled && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">
              {t("webGateway.devicesTitle")}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={devicesLoading}
              onClick={() => void refreshDevices()}
            >
              {devicesLoading
                ? t("webGateway.devicesRefreshing")
                : t("webGateway.devicesRefreshBtn")}
            </Button>
          </div>

          {devicesLoading ? (
            <p className="text-xs text-muted-foreground">
              {t("webGateway.devicesLoading")}
            </p>
          ) : devices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("webGateway.devicesEmpty")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {devices.map((dev) => (
                <li
                  key={dev.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  {editingId === dev.id ? (
                    <>
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-8 min-w-0 flex-1 text-sm"
                        maxLength={60}
                        autoFocus
                        disabled={renaming}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleRename();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        aria-label={t("webGateway.renameLabel")}
                      />
                      <div className="flex shrink-0 gap-1.5">
                        <Button
                          size="sm"
                          className="h-8"
                          disabled={renaming || !editValue.trim()}
                          onClick={() => void handleRename()}
                        >
                          {renaming ? t("webGateway.renaming") : t("webGateway.renameSave")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={renaming}
                          onClick={() => setEditingId(null)}
                        >
                          {t("webGateway.renameCancel")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">
                          {dev.label || t("webGateway.deviceLabelUnknown")}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {t("webGateway.devicePairedAt", { at: dev.paired_at })}
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          disabled={editingId !== null || revokingId !== null}
                          onClick={() => startEdit(dev.id, dev.label)}
                        >
                          {t("webGateway.renameBtn")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={revokingId !== null}
                          onClick={() => void handleRevoke(dev.id)}
                        >
                          {revokingId === dev.id
                            ? t("webGateway.revoking")
                            : t("webGateway.revokeBtn")}
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
