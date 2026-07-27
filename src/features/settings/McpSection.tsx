// MCP 接入区（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// 让本地 claude / codex 通过 rework 内置 MCP server 操作看板与文档；
// 一键写入客户端配置（~/.claude.json / ~/.codex/config.toml）。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";

export function McpSection() {
  const { t } = useTranslation("settings");
  const [endpoint, setEndpoint] = useState<{ url: string } | null>(null);
  const [busy, setBusy] = useState<"claude" | "codex" | null>(null);

  useEffect(() => {
    void ipc
      .mcpEndpoint()
      .then(setEndpoint)
      .catch(() => setEndpoint(null));
  }, []);

  const install = async (target: "claude" | "codex") => {
    setBusy(target);
    try {
      const msg =
        target === "claude"
          ? await ipc.mcpInstallClaude()
          : await ipc.mcpInstallCodex();
      toast.success(msg);
    } catch (e) {
      toast.error(t("mcp.connectError", { message: String(e) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("mcp.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("mcp.desc")}
        </p>
      </div>

      {endpoint ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("mcp.endpoint")}<span className="font-mono text-foreground">{endpoint.url}</span>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("mcp.endpointNotReady")}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!endpoint || busy !== null}
          onClick={() => void install("claude")}
        >
          {busy === "claude" ? t("mcp.connecting") : t("mcp.connectClaude")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!endpoint || busy !== null}
          onClick={() => void install("codex")}
        >
          {busy === "codex" ? t("mcp.connecting") : t("mcp.connectCodex")}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("mcp.hint")}
      </p>
    </section>
  );
}
