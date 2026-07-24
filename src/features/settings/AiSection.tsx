// AI 助手配置区（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// aiConfig 来源 useSettingsStore（写入即持久化 localStorage）；模型建议本地拉取。
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/store/settings";
import type { AiProvider } from "@/types/ai";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";

export function AiSection() {
  // AI 助手配置（受控，来源于 store，写入即持久化 localStorage）
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const setAiConfig = useSettingsStore((s) => s.setAiConfig);

  // 模型列表（可选：从服务商 /models 接口拉取，作为输入建议；拉不到则纯手填）
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // 切换服务商时清空上一个商的模型建议，避免张冠李戴
  useEffect(() => {
    setModels([]);
  }, [aiConfig.provider]);

  // 拉取当前服务商的可用模型；成功给下拉建议，失败/为空提示手动输入
  const fetchModels = async () => {
    if (modelsLoading) return;
    setModelsLoading(true);
    try {
      const list = await ipc.listModels(aiConfig);
      setModels(list);
      toast[list.length ? "success" : "message"](
        list.length ? `获取到 ${list.length} 个模型` : "未获取到模型列表，请手动输入",
      );
    } catch (e) {
      setModels([]);
      toast.error(`拉取模型失败，请手动输入：${e instanceof Error ? e.message : e}`);
    } finally {
      setModelsLoading(false);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">AI 助手</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          配置项目工作台「AI」标签使用的模型服务；密钥仅保存在本机。
        </p>
      </div>

      {/* 服务商选择 */}
      <div className="space-y-1.5">
        <Label htmlFor="ai-provider">服务商</Label>
        <Select
          value={aiConfig.provider}
          onValueChange={(v) => setAiConfig({ provider: v as AiProvider })}
        >
          <SelectTrigger id="ai-provider" className="w-full">
            <SelectValue placeholder="选择服务商" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">OpenAI 兼容</SelectItem>
            <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
            <SelectItem value="claude-cli">Claude Code（本地 CLI）</SelectItem>
            <SelectItem value="codex-cli">Codex（本地 CLI）</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 本地 CLI provider 无需 base_url / api_key */}
      {(() => {
        const isCliProvider =
          aiConfig.provider === "claude-cli" || aiConfig.provider === "codex-cli";
        return (
          <>
            {!isCliProvider && (
              <>
                {/* 接口 Base URL */}
                <div className="space-y-1.5">
                  <Label htmlFor="ai-base-url">Base URL</Label>
                  <Input
                    id="ai-base-url"
                    type="text"
                    value={aiConfig.base_url}
                    placeholder={
                      aiConfig.provider === "anthropic"
                        ? "https://api.anthropic.com（留空用默认）"
                        : "https://api.openai.com/v1（留空用默认）"
                    }
                    onChange={(e) => setAiConfig({ base_url: e.target.value })}
                  />
                </div>

                {/* API 密钥（明文不回显，仅本机保存） */}
                <div className="space-y-1.5">
                  <Label htmlFor="ai-api-key">API 密钥</Label>
                  <Input
                    id="ai-api-key"
                    type="password"
                    autoComplete="off"
                    value={aiConfig.api_key}
                    placeholder="sk-..."
                    onChange={(e) => setAiConfig({ api_key: e.target.value })}
                  />
                </div>

                {/* 模型名称：本地 CLI 由自身决定模型、无需填写，故仅非 CLI 服务商显示。
                    可点「拉取模型」从服务商 /models 接口取建议（datalist），拉不到则手动输入。 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ai-model">模型</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      disabled={modelsLoading}
                      onClick={() => void fetchModels()}
                    >
                      {modelsLoading ? "拉取中…" : "拉取模型"}
                    </Button>
                  </div>
                  <Input
                    id="ai-model"
                    type="text"
                    list="ai-model-suggestions"
                    value={aiConfig.model}
                    placeholder="gpt-4o-mini / claude-3-5-sonnet-...（可点『拉取模型』获取建议）"
                    onChange={(e) => setAiConfig({ model: e.target.value })}
                  />
                  {models.length > 0 && (
                    <datalist id="ai-model-suggestions">
                      {models.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  )}
                </div>
              </>
            )}

            {/* CLI provider：可选命令路径 + 说明 */}
            {isCliProvider && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-cli-path">命令路径（可选）</Label>
                  <Input
                    id="ai-cli-path"
                    type="text"
                    value={aiConfig.cli_path ?? ""}
                    placeholder={
                      aiConfig.provider === "codex-cli"
                        ? "留空自动查找；如 C:\\Users\\you\\AppData\\Roaming\\npm\\codex.cmd"
                        : "留空自动查找；如 C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd"
                    }
                    onChange={(e) => setAiConfig({ cli_path: e.target.value })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  将调用本机的{" "}
                  <code>{aiConfig.provider === "codex-cli" ? "codex" : "claude"}</code>{" "}
                  命令行（走本地订阅，数据不出本机）。若提示「program not found」但终端里能运行，
                  在上面填它的绝对路径即可（终端里用 <code>where {aiConfig.provider === "codex-cli" ? "codex" : "claude"}</code> 查）。
                </p>
              </>
            )}
          </>
        );
      })()}
    </section>
  );
}
