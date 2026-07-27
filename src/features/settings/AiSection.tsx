// AI 助手配置区（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// aiConfig 来源 useSettingsStore（写入即持久化 localStorage）；模型建议本地拉取。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("settings");
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
        list.length
          ? t("ai.model.fetchSuccess", { count: list.length })
          : t("ai.model.fetchEmpty"),
      );
    } catch (e) {
      setModels([]);
      toast.error(
        t("ai.model.fetchError", { message: e instanceof Error ? e.message : String(e) }),
      );
    } finally {
      setModelsLoading(false);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("ai.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("ai.desc")}
        </p>
      </div>

      {/* 服务商选择 */}
      <div className="space-y-1.5">
        <Label htmlFor="ai-provider">{t("ai.provider.label")}</Label>
        <Select
          value={aiConfig.provider}
          onValueChange={(v) => setAiConfig({ provider: v as AiProvider })}
        >
          <SelectTrigger id="ai-provider" className="w-full">
            <SelectValue placeholder={t("ai.provider.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">{t("ai.provider.openai")}</SelectItem>
            <SelectItem value="anthropic">{t("ai.provider.anthropic")}</SelectItem>
            <SelectItem value="claude-cli">{t("ai.provider.claudeCli")}</SelectItem>
            <SelectItem value="codex-cli">{t("ai.provider.codexCli")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 本地 CLI provider 无需 base_url / api_key */}
      {(() => {
        const isCliProvider =
          aiConfig.provider === "claude-cli" || aiConfig.provider === "codex-cli";
        const cliCmd = aiConfig.provider === "codex-cli" ? "codex" : "claude";
        return (
          <>
            {!isCliProvider && (
              <>
                {/* 接口 Base URL */}
                <div className="space-y-1.5">
                  <Label htmlFor="ai-base-url">{t("ai.baseUrl.label")}</Label>
                  <Input
                    id="ai-base-url"
                    type="text"
                    value={aiConfig.base_url}
                    placeholder={
                      aiConfig.provider === "anthropic"
                        ? t("ai.apiBaseUrlPlaceholderAnthropic")
                        : t("ai.apiBaseUrlPlaceholderOpenai")
                    }
                    onChange={(e) => setAiConfig({ base_url: e.target.value })}
                  />
                </div>

                {/* API 密钥（明文不回显，仅本机保存） */}
                <div className="space-y-1.5">
                  <Label htmlFor="ai-api-key">{t("ai.apiKey.label")}</Label>
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
                    <Label htmlFor="ai-model">{t("ai.model.label")}</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      disabled={modelsLoading}
                      onClick={() => void fetchModels()}
                    >
                      {modelsLoading ? t("ai.model.fetching") : t("ai.model.fetchBtn")}
                    </Button>
                  </div>
                  <Input
                    id="ai-model"
                    type="text"
                    list="ai-model-suggestions"
                    value={aiConfig.model}
                    placeholder={t("ai.model.placeholder")}
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
                  <Label htmlFor="ai-cli-path">{t("ai.cliPath.label")}</Label>
                  <Input
                    id="ai-cli-path"
                    type="text"
                    value={aiConfig.cli_path ?? ""}
                    placeholder={
                      aiConfig.provider === "codex-cli"
                        ? t("ai.cliPath.placeholderCodex")
                        : t("ai.cliPath.placeholderClaude")
                    }
                    onChange={(e) => setAiConfig({ cli_path: e.target.value })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("ai.cliHint", { cmd: cliCmd })}
                </p>
              </>
            )}
          </>
        );
      })()}
    </section>
  );
}
