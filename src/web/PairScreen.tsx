import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markPaired } from "./auth-expiry";

interface PairScreenProps {
  /** 配对成功后回调，父组件更新 UI 状态 */
  onPaired: () => void;
}

export function PairScreen({ onPaired }: PairScreenProps) {
  const { t } = useTranslation("web");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    setLoading(true);
    try {
      const res = await fetch("/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });

      if (res.ok) {
        // cookie 由 Set-Cookie 自动写入（HttpOnly，JS 不可读）
        // 仅用 localStorage 标记 UI 态，真凭证是 httpOnly cookie
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

        {/* 配对表单 */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="text"
            autoComplete="off"
            autoFocus
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
