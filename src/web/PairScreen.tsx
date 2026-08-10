import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markPaired } from "./auth-expiry";

interface PairScreenProps {
  /** 配对成功后回调，父组件更新 UI 状态 */
  onPaired: () => void;
}

/** 相机容器的固定 id（html5-qrcode 按 id 挂载视频）。 */
const READER_ID = "qr-reader";

export function PairScreen({ onPaired }: PairScreenProps) {
  const { t } = useTranslation("web");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // 用配对码换 cookie（表单提交与扫码成功共用）
  async function pair(value: string) {
    const c = value.trim();
    if (!c) return;
    setLoading(true);
    try {
      const res = await fetch("/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      if (res.ok) {
        // cookie 由 Set-Cookie 自动写入（HttpOnly，JS 不可读）；localStorage 仅标记 UI 态
        markPaired();
        onPaired();
      } else if (res.status === 401) {
        toast.error(t("pair.error.invalid"));
      } else {
        toast.error(t("pair.error.unknown"));
      }
    } catch {
      toast.error(t("pair.error.network"));
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void pair(code);
  }

  // 扫码生命周期：scanning 打开时启动相机，扫到码即停、填入并直接配对。
  // 相机需安全上下文（HTTPS / localhost）——经 Tailscale HTTPS 访问满足；明文 http 会被浏览器拒。
  useEffect(() => {
    if (!scanning) return;
    const scanner = new Html5Qrcode(READER_ID);
    scannerRef.current = scanner;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      scanner.stop().catch(() => {}); // 忽略已停/未启的错误
      scannerRef.current = null;
    };
    scanner
      .start(
        { facingMode: "environment" }, // 后置摄像头
        { fps: 10, qrbox: 220 },
        (decoded) => {
          stop();
          setScanning(false);
          setCode(decoded);
          void pair(decoded); // 扫到即配对
        },
        () => {
          /* 每帧未识别的回调：忽略 */
        },
      )
      .catch(() => {
        // 相机打不开（未授权 / 非安全上下文 / 无相机）
        toast.error(t("pair.scanError"));
        setScanning(false);
        stop();
      });
    return stop;
    // pair/t 稳定，无需入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* 品牌标识 */}
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("pair.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("pair.subtitle")}</p>
        </div>

        {/* 扫码区：打开相机扫桌面显示的配对码二维码 */}
        {scanning ? (
          <div className="space-y-2">
            <div id={READER_ID} className="overflow-hidden rounded-lg" />
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setScanning(false)}
            >
              {t("pair.scanClose")}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setScanning(true)}
            disabled={loading}
          >
            {t("pair.scan")}
          </Button>
        )}

        {/* 配对表单（手输兜底） */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="text"
            autoComplete="off"
            placeholder={t("pair.codePlaceholder")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={loading}
            aria-label={t("pair.codePlaceholder")}
          />
          <Button
            type="submit"
            className="w-full"
            disabled={loading || !code.trim()}
          >
            {loading ? t("pair.submitting") : t("pair.submit")}
          </Button>
        </form>
      </div>
    </div>
  );
}
