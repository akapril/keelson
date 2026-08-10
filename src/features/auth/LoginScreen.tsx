// 登录/注册界面 —— 仅远程模式(设了远程 PB URL)且未认证时展示；本地模式免登录不经此。
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Logo } from "@/components/logo";
import { useAuthStore } from "@/store/auth";
import { getRemotePbUrl, setRemotePbUrl } from "@/lib/pb";

export function LoginScreen() {
  const { t } = useTranslation("shell");
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  const [tab, setTab] = useState("login");
  const [identity, setIdentity] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // 远程 PB 地址（登录页只在远程模式出现；展示它 + 提供"切回本地"逃生入口，
  // 避免远程连不上时被死锁在登录页——设置藏在认证之后够不到）。
  const remoteUrl = getRemotePbUrl();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setLoading(true);
    try {
      if (tab === "login") {
        await login(identity, password);
      } else {
        if (password.length < 8) throw new Error(t("auth.errorPasswordMin"));
        await register(email, password, name);
      }
      // 成功后 authed=true，App 自动切换到主界面
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        {/* 品牌（用统一的 Logo，与侧栏/标题栏一致，勿用通用图标） */}
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo className="size-11" />
          <div className="text-center">
            <div className="text-lg font-semibold">Keelson</div>
            <div className="text-xs text-muted-foreground">{t("auth.tagline")}</div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <Tabs value={tab} onValueChange={(v) => { setTab(v); setError(undefined); }}>
            <TabsList className="mb-4 w-full">
              <TabsTrigger value="login">{t("auth.tabLogin")}</TabsTrigger>
              <TabsTrigger value="register">{t("auth.tabRegister")}</TabsTrigger>
            </TabsList>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <TabsContent value="login" className="m-0 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lg-id">{t("auth.fieldEmail")}</Label>
                  <Input
                    id="lg-id"
                    type="email"
                    autoComplete="username"
                    value={identity}
                    onChange={(e) => setIdentity(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </TabsContent>

              <TabsContent value="register" className="m-0 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rg-email">{t("auth.fieldEmail")}</Label>
                  <Input
                    id="rg-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rg-name">{t("auth.fieldNickname")}</Label>
                  <Input
                    id="rg-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("auth.nicknamePlaceholder")}
                  />
                </div>
              </TabsContent>

              {/* 密码（两个 tab 共用） */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw">{t("auth.fieldPassword")}</Label>
                <Input
                  id="pw"
                  type="password"
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={tab === "register" ? t("auth.passwordPlaceholderMin") : t("auth.passwordPlaceholderHide")}
                  required
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}

              <Button type="submit" disabled={loading} className="w-full">
                {loading
                  ? t("auth.submitLoading")
                  : tab === "login"
                    ? t("auth.submitLogin")
                    : t("auth.submitRegister")}
              </Button>
            </form>
          </Tabs>
        </div>

        {/* 逃生入口：远程模式下若连不上，一键切回本地免登录，避免死锁在登录页 */}
        {remoteUrl && (
          <div className="mt-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <div className="truncate">
              {t("auth.remoteConnecting")}
              <span className="ml-1 font-mono text-foreground">{remoteUrl}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setRemotePbUrl("");
                window.location.reload();
              }}
              className="mt-1 text-primary hover:underline"
            >
              {t("auth.switchLocal")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
