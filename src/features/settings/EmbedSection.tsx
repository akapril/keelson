// 检索 / 嵌入配置区（从 pages/settings.tsx 拆出，逻辑逐字保留）。
// embed 配置本地维护（与 AskPane 共享 localStorage key rework-embed-config）；
// aiConfig 从 store 订阅，用于「复用 AI 密钥」。
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useSettingsStore } from "@/store/settings";
import { DEFAULT_EMBED_CONFIG } from "@/types/rag";
import type { EmbedConfig } from "@/types/rag";
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
import { on } from "@/lib/tauri/events";

export function EmbedSection() {
  const { t } = useTranslation("settings");
  // AI 对话配置（用于「复用 AI 密钥」）
  const aiConfig = useSettingsStore((s) => s.aiConfig);

  // 检索 / 嵌入配置（与 AskPane 共享同一 localStorage key：rework-embed-config）
  const [embedCfg, setEmbedCfgState] = useState<EmbedConfig>(() => {
    try {
      const raw = localStorage.getItem("keelson-embed-config");
      return { ...DEFAULT_EMBED_CONFIG, ...(raw ? JSON.parse(raw) : {}) };
    } catch {
      return { ...DEFAULT_EMBED_CONFIG };
    }
  });

  // 「重建索引」加载状态 + 进度(会话数，0/结束为 null)
  const [rebuilding, setRebuilding] = useState(false);
  const [indexProgress, setIndexProgress] = useState<number | null>(null);
  // 上次成功建索引时的 embed 标识（provider:model），用于提示"配置已变，请重建"
  const [lastIndexedModel, setLastIndexedModel] = useState<string>(
    () => localStorage.getItem("keelson-rag-indexed-model") ?? "",
  );

  // 监听后端索引进度事件（rag_build_index emit）
  useEffect(() => {
    const p = on<number>("rag-index-progress", (n) => setIndexProgress(n > 0 ? n : null));
    return () => {
      void p.then((un) => un());
    };
  }, []);

  /**
   * 更新嵌入配置。按嵌入服务商隔离各自字段，切换服务商互不覆盖：
   * - rework-embed-config 保存「当前激活」的扁平配置（AskPane 读这份，结构不变）；
   * - rework-embed-by-provider 保存每个服务商各自的 {base_url,api_key,model} 快照。
   */
  function setEmbed(patch: Partial<EmbedConfig>) {
    type EmbedFields = Omit<EmbedConfig, "provider">;
    const MAP_KEY = "keelson-embed-by-provider";
    const loadMap = (): Record<string, EmbedFields> => {
      try {
        const raw = localStorage.getItem(MAP_KEY);
        return raw ? (JSON.parse(raw) as Record<string, EmbedFields>) : {};
      } catch {
        return {};
      }
    };
    setEmbedCfgState((prev) => {
      const map = loadMap();
      // 先把当前服务商字段快照进 map（不含 provider）
      map[prev.provider] = { base_url: prev.base_url, api_key: prev.api_key, model: prev.model };

      let next: EmbedConfig;
      if (patch.provider && patch.provider !== prev.provider) {
        // 切换服务商：取目标商已存字段，缺省用默认（模型预填默认，key/url 留空）
        const f = map[patch.provider] ?? {
          base_url: "",
          api_key: "",
          model: DEFAULT_EMBED_CONFIG.model,
        };
        next = { provider: patch.provider, ...f };
      } else {
        // 同一服务商内改字段：更新当前商的快照
        next = { ...prev, ...patch };
        map[next.provider] = { base_url: next.base_url, api_key: next.api_key, model: next.model };
      }
      try {
        localStorage.setItem("keelson-embed-config", JSON.stringify(next)); // AskPane 读的扁平当前值
        localStorage.setItem(MAP_KEY, JSON.stringify(map));
      } catch {
        // 忽略 localStorage 写入失败（如隐私模式）
      }
      return next;
    });
  }

  // 当前嵌入标识 + 索引是否可能过期（已建过、但 provider/model 变了）
  const embedModelId = `${embedCfg.provider}:${embedCfg.model}`;
  const indexStale = !!lastIndexedModel && lastIndexedModel !== embedModelId;
  // AI 对话是否为「OpenAI 兼容 + 有 key」，可复用其密钥做 embeddings
  const aiReusable = aiConfig.provider === "openai" && !!aiConfig.api_key;

  /** 一键复用 AI 对话的 OpenAI 密钥做 embeddings（切到 api 并填 base_url/key/model） */
  const reuseAiKey = () => {
    if (!aiReusable) return;
    setEmbed({ provider: "api" }); // 先切 provider（其字段隔离逻辑会先加载 api 快照）
    setEmbed({
      base_url: aiConfig.base_url,
      api_key: aiConfig.api_key,
      model: "text-embedding-3-small",
    });
    toast.success(t("embed.reuseAiKeySuccess"));
  };

  /** 调用后端重建全量嵌入索引 */
  const rebuildIndex = async () => {
    setRebuilding(true);
    try {
      const n = await ipc.ragBuildIndex(embedCfg);
      if (n === 0) {
        toast(t("embed.rebuildEmpty"));
      } else {
        toast.success(t("embed.rebuildSuccess", { count: n }));
        // 记录本次索引的 embed 标识，供"过期"提示比对
        localStorage.setItem("keelson-rag-indexed-model", embedModelId);
        setLastIndexedModel(embedModelId);
      }
    } catch (e) {
      toast.error(t("embed.rebuildError", { message: String(e) }));
    } finally {
      setRebuilding(false);
      setIndexProgress(null);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("embed.title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("embed.desc")}
        </p>
      </div>

      {/* 嵌入服务商 */}
      <div className="space-y-1.5">
        <Label htmlFor="embed-provider">{t("embed.provider.label")}</Label>
        <Select
          value={embedCfg.provider}
          onValueChange={(v) => setEmbed({ provider: v })}
        >
          <SelectTrigger id="embed-provider" className="w-full">
            <SelectValue placeholder={t("embed.provider.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">{t("embed.provider.local")}</SelectItem>
            <SelectItem value="api">{t("embed.provider.api")}</SelectItem>
            <SelectItem value="mock">{t("embed.provider.mock")}</SelectItem>
          </SelectContent>
        </Select>
        {embedCfg.provider === "mock" && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {/* <1>...</1> 对应 strong（关键词检索 是强调文本） */}
            <Trans
              i18nKey="embed.mockWarning"
              ns="settings"
              components={{ 1: <strong /> }}
            />
          </p>
        )}
        {embedCfg.provider === "local" && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {/* <1>...</1> 对应 code（--features local-embed 是命令参数） */}
            <Trans
              i18nKey="embed.localWarning"
              ns="settings"
              components={{ 1: <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" /> }}
            />
          </p>
        )}
        {/* 主线 A：一键复用 AI 对话的 OpenAI 密钥 */}
        <button
          type="button"
          onClick={reuseAiKey}
          disabled={!aiReusable}
          title={
            aiReusable
              ? t("embed.reuseAiKeyTitle")
              : t("embed.reuseAiKeyDisabledTitle")
          }
          className="text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
        >
          {t("embed.reuseAiKey")}
        </button>
      </div>

      {/* 仅 api 时显示 base_url 和 api_key */}
      {embedCfg.provider === "api" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="embed-base-url">{t("embed.baseUrl.label")}</Label>
            <Input
              id="embed-base-url"
              type="text"
              value={embedCfg.base_url}
              placeholder={t("embed.baseUrl.placeholder")}
              onChange={(e) => setEmbed({ base_url: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="embed-api-key">{t("embed.apiKey.label")}</Label>
            <Input
              id="embed-api-key"
              type="password"
              autoComplete="off"
              value={embedCfg.api_key}
              placeholder="sk-..."
              onChange={(e) => setEmbed({ api_key: e.target.value })}
            />
          </div>
        </>
      )}

      {/* 模型名称（所有 provider 可见） */}
      <div className="space-y-1.5">
        <Label htmlFor="embed-model">{t("embed.model.label")}</Label>
        <Input
          id="embed-model"
          type="text"
          value={embedCfg.model}
          placeholder="text-embedding-3-small"
          onChange={(e) => setEmbed({ model: e.target.value })}
        />
      </div>

      {/* 索引过期提示（provider/model 变了） */}
      {indexStale && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("embed.indexStale", { model: lastIndexedModel })}
        </p>
      )}

      {/* 重建索引 + 进度 */}
      <div className="flex items-center gap-3">
        <Button onClick={rebuildIndex} disabled={rebuilding} variant="outline" size="sm">
          {rebuilding ? t("embed.rebuilding") : t("embed.rebuildBtn")}
        </Button>
        {rebuilding && indexProgress != null && (
          <span className="text-xs text-muted-foreground">
            {t("embed.rebuildProgress", { count: indexProgress })}
          </span>
        )}
      </div>

      {/* 数据流向说明 */}
      <p className="text-xs text-muted-foreground">
        {embedCfg.provider === "api"
          ? t("embed.dataNote.api")
          : t("embed.dataNote.local")}
      </p>
    </section>
  );
}
