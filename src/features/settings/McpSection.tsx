// MCP 接入区（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// 让本地 claude / codex 通过 rework 内置 MCP server 操作看板与文档；
// 一键写入客户端配置（~/.claude.json / ~/.codex/config.toml）。
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";

export function McpSection() {
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
      toast.error(`接入失败：${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">MCP 接入（claude / codex）</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          让本地 claude / codex 直接操作你的看板任务与文档。一键写入客户端配置，无需手动命令。
          需重启客户端会话生效。
        </p>
      </div>

      {endpoint ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          端点：<span className="font-mono text-foreground">{endpoint.url}</span>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          MCP 端点未就绪（应用可能刚启动，稍后重进设置页）。
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!endpoint || busy !== null}
          onClick={() => void install("claude")}
        >
          {busy === "claude" ? "接入中…" : "接入 Claude Code"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!endpoint || busy !== null}
          onClick={() => void install("codex")}
        >
          {busy === "codex" ? "接入中…" : "接入 Codex"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        提示：secret 已持久化，端口固定 47600，接入一次长期有效（除非端口被占用回退）。
        仅本机（127.0.0.1）；需 Keelson 应用开着。
      </p>
    </section>
  );
}
