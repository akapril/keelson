// 登录/注册界面 —— bootstrap 完成但未认证（用户已登出/切换）时展示。
import { useState, type FormEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { FolderLibraryIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuthStore } from "@/store/auth";

export function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  const [tab, setTab] = useState("login");
  const [identity, setIdentity] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setLoading(true);
    try {
      if (tab === "login") {
        await login(identity, password);
      } else {
        if (password.length < 8) throw new Error("密码至少 8 位");
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
        {/* 品牌 */}
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <HugeiconsIcon icon={FolderLibraryIcon} strokeWidth={2} className="size-5" />
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold">rework</div>
            <div className="text-xs text-muted-foreground">会话 · 项目 · 看板</div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <Tabs value={tab} onValueChange={(v) => { setTab(v); setError(undefined); }}>
            <TabsList className="mb-4 w-full">
              <TabsTrigger value="login">登录</TabsTrigger>
              <TabsTrigger value="register">注册</TabsTrigger>
            </TabsList>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <TabsContent value="login" className="m-0 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lg-id">邮箱</Label>
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
                  <Label htmlFor="rg-email">邮箱</Label>
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
                  <Label htmlFor="rg-name">昵称</Label>
                  <Input
                    id="rg-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="显示名称"
                  />
                </div>
              </TabsContent>

              {/* 密码（两个 tab 共用） */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw">密码</Label>
                <Input
                  id="pw"
                  type="password"
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={tab === "register" ? "至少 8 位" : "••••••••"}
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
                  ? "请稍候…"
                  : tab === "login"
                    ? "登录"
                    : "注册并登录"}
              </Button>
            </form>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
