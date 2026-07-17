import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../store/settings";
import type { AiProvider } from "../types/ai";
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
import { ExportSection } from "@/features/export/ExportSection";
import { UpdateSection } from "@/features/updater/UpdateSection";
import { BackendSection } from "@/features/backend/BackendSection";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";
import {
  newSessionsPref,
  setNewSessionsPref,
} from "@/features/notifications/new-sessions";
import { DEFAULT_EMBED_CONFIG } from "@/types/rag";
import type { EmbedConfig } from "@/types/rag";

// ── 快捷键字符串构建辅助 ───────────────────────────────────────
/**
 * 从 KeyboardEvent 构建形如 "CommandOrControl+Shift+Space" 的快捷键字符串。
 * 遵循 tauri_plugin_global_shortcut 期望的格式。
 */
function buildHotkeyString(e: KeyboardEvent): string {
  const parts: string[] = [];

  // 修饰键（按固定顺序，避免 "Shift+Ctrl" vs "Ctrl+Shift" 歧义）
  if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  // 主键（排除纯修饰键按下）
  const MODIFIER_KEYS = new Set([
    "Control", "Meta", "Alt", "Shift",
    "CapsLock", "NumLock", "ScrollLock",
  ]);
  if (!MODIFIER_KEYS.has(e.key)) {
    // 将浏览器 key 名称标准化为 Tauri 期望格式
    const key = normalizeKey(e.key, e.code);
    parts.push(key);
  }

  return parts.join("+");
}

/**
 * 将浏览器 KeyboardEvent.key 标准化为 Tauri 快捷键格式。
 * 参考：https://docs.rs/global-hotkey/latest/global_hotkey/hotkey/enum.Code.html
 */
function normalizeKey(key: string, code: string): string {
  // 功能键直接使用
  if (/^F\d+$/.test(key)) return key;
  // 空格
  if (key === " " || key === "Spacebar") return "Space";
  // 方向键
  const arrowMap: Record<string, string> = {
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  };
  if (key in arrowMap) return arrowMap[key];
  // 单字符：数字和字母直接大写
  if (key.length === 1) return key.toUpperCase();
  // 其余（Escape、Enter、Tab、Backspace 等）直接透传
  // 对于 code 中的 Key* / Digit* 作为兜底
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return key;
}

// ── 快捷键捕获控件 ────────────────────────────────────────────
interface HotkeyCaptureProps {
  value: string;
  onCapture: (hotkey: string) => void;
  disabled?: boolean;
}

function HotkeyCapture({ value, onCapture, disabled }: HotkeyCaptureProps) {
  // 是否处于"捕获中"状态
  const [capturing, setCapturing] = useState(false);
  // 捕获中显示的预览字符串
  const [preview, setPreview] = useState("");
  const divRef = useRef<HTMLDivElement>(null);

  // 进入捕获模式：聚焦 div 并重置预览
  function startCapture() {
    if (disabled) return;
    setCapturing(true);
    setPreview("");
    divRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();

    // Escape 取消捕获
    if (e.key === "Escape") {
      setCapturing(false);
      setPreview("");
      return;
    }

    const combo = buildHotkeyString(e.nativeEvent);
    setPreview(combo);

    // 只有包含非修饰键时才视为完整组合，触发回调
    const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift"]);
    if (!MODIFIER_KEYS.has(e.key) && combo.includes("+")) {
      setCapturing(false);
      onCapture(combo);
    }
  }

  function handleBlur() {
    // 失焦时退出捕获模式
    setCapturing(false);
    setPreview("");
  }

  // 显示文本：捕获中 → 预览；否则 → 当前值（或提示）
  const displayText = capturing
    ? preview || "按下快捷键组合…"
    : value || "点击以设置";

  return (
    <div
      ref={divRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={`快捷键输入，当前：${value || "未设置"}`}
      aria-disabled={disabled}
      onMouseDown={startCapture}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      className={[
        "inline-flex min-w-48 cursor-pointer select-none items-center",
        "rounded-md border px-3 py-1.5 font-mono text-sm",
        "transition-colors focus:outline-none",
        capturing
          ? "border-ring bg-accent text-accent-foreground ring-2 ring-ring"
          : "border-border bg-muted text-foreground hover:bg-accent hover:text-accent-foreground",
        disabled ? "pointer-events-none opacity-50" : "",
      ].join(" ")}
    >
      {displayText}
    </div>
  );
}

// ── 设置页面主体 ───────────────────────────────────────────────
/**
 * 设置页面。
 *
 * 功能：
 * 1. 全局唤起快捷键 — 通过 HotkeyCapture 控件捕获，经 useSettingsStore.saveHotkey
 *    调用 ipc.setHotkey 持久化，并在 Rust 端立即重新注册（Task 21）。
 * 2. 工作区路径 — 本地状态编辑，MVP 阶段前端维护（useSettingsStore.workspacePath
 *    暂不持久化到后端，符合 Task 17 设计）。
 *
 * 颜色全部使用 Tailwind 语义类（无硬编码 hex/rgba），自动适配明暗主题。
 */

/**
 * MCP 接入区：让本地 claude / codex 通过 rework 内置 MCP server 操作看板与文档。
 * 一键把 rework 写入客户端配置（~/.claude.json / ~/.codex/config.toml），无需手动 claude mcp add。
 */
function McpSection() {
  const [endpoint, setEndpoint] = useState<{ url: string; secret: string } | null>(null);
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
        仅本机（127.0.0.1）；需 rework 应用开着。
      </p>
    </section>
  );
}

/** 通知偏好:发现新会话提醒开关(启动时摘要,可关)。 */
function NotifyPrefsSection() {
  const [on, setOn] = useState(newSessionsPref());
  const toggle = (v: boolean) => {
    setOn(v);
    setNewSessionsPref(v);
  };
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">通知偏好</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          控制哪些事件推送到通知中心。
        </p>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => toggle(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-input accent-primary"
        />
        <span>发现新的本地 CLI 会话时提醒（启动时汇总一条）</span>
      </label>
    </section>
  );
}

export default function Settings() {
  const { hotkey, workspacePath, loading, error, load, saveHotkey } =
    useSettingsStore();

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

  // 本地工作区路径编辑状态（不直接写 store 的 workspacePath 避免频繁触发渲染）
  const [localPath, setLocalPath] = useState(workspacePath);

  // 检索 / 嵌入配置（与 AskPane 共享同一 localStorage key：rework-embed-config）
  const [embedCfg, setEmbedCfgState] = useState<EmbedConfig>(() => {
    try {
      const raw = localStorage.getItem("rework-embed-config");
      return { ...DEFAULT_EMBED_CONFIG, ...(raw ? JSON.parse(raw) : {}) };
    } catch {
      return { ...DEFAULT_EMBED_CONFIG };
    }
  });

  // 「重建索引」加载状态
  const [rebuilding, setRebuilding] = useState(false);

  /**
   * 更新嵌入配置。按嵌入服务商隔离各自字段，切换服务商互不覆盖：
   * - rework-embed-config 保存「当前激活」的扁平配置（AskPane 读这份，结构不变）；
   * - rework-embed-by-provider 保存每个服务商各自的 {base_url,api_key,model} 快照。
   */
  function setEmbed(patch: Partial<EmbedConfig>) {
    type EmbedFields = Omit<EmbedConfig, "provider">;
    const MAP_KEY = "rework-embed-by-provider";
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
        localStorage.setItem("rework-embed-config", JSON.stringify(next)); // AskPane 读的扁平当前值
        localStorage.setItem(MAP_KEY, JSON.stringify(map));
      } catch {
        // 忽略 localStorage 写入失败（如隐私模式）
      }
      return next;
    });
  }

  /** 调用后端重建全量嵌入索引 */
  const rebuildIndex = async () => {
    setRebuilding(true);
    try {
      const n = await ipc.ragBuildIndex(embedCfg);
      if (n === 0) {
        toast(`暂无会话可索引（可能扫描未完成）`);
      } else {
        toast.success(`索引完成：${n} 个片段`);
      }
    } catch (e) {
      toast.error(`索引失败：${String(e)}`);
    } finally {
      setRebuilding(false);
    }
  };

  // 挂载时从后端加载设置
  useEffect(() => {
    load();
  }, [load]);

  // 当 store 中的 workspacePath 更新时同步本地状态
  useEffect(() => {
    setLocalPath(workspacePath);
  }, [workspacePath]);

  // 捕获到完整快捷键组合时保存
  function handleHotkeyCapture(combo: string) {
    saveHotkey(combo);
  }

  return (
    <div className="mx-auto max-w-xl space-y-8 px-6 py-6">
      <h1 className="text-lg font-semibold">设置</h1>

      {/* 错误提示 */}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* ── 全局唤起快捷键 ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">全局唤起快捷键</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            在任意界面按下此组合键，即可唤起 / 隐藏 Spotlight 搜索窗口。
            修改后立即生效，无需重启。
          </p>
        </div>

        <div className="flex items-center gap-3">
          <HotkeyCapture
            value={hotkey}
            onCapture={handleHotkeyCapture}
            disabled={loading}
          />
          {loading && (
            <span className="text-xs text-muted-foreground">保存中…</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          点击上方控件后，按下目标组合键（需含修饰键，如 Ctrl / Alt / Shift）；按 Esc 取消捕获。
        </p>
      </section>

      <div className="border-t border-border" />

      {/* ── 工作区路径 ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">工作区路径</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Claude / Codex 会话所在的根目录（MVP 阶段仅本地保存，不同步后端）。
          </p>
        </div>

        <input
          type="text"
          aria-label="工作区路径"
          placeholder="/Users/you/projects 或 C:\Users\you\projects"
          value={localPath}
          onChange={(e) => setLocalPath(e.target.value)}
          className={[
            "w-full rounded-md border border-input bg-background px-3 py-1.5",
            "text-sm text-foreground placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring",
          ].join(" ")}
        />

        <p className="text-xs text-muted-foreground">
          留空则使用默认路径（~/.claude / ~/.codex）。
        </p>
      </section>

      <div className="border-t border-border" />

      {/* ── AI 助手 ── */}
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

      <div className="border-t border-border" />

      {/* ── 检索 / 嵌入 ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">检索 / 嵌入</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            配置「问」模式的语义检索嵌入服务；密钥仅保存在本机。
          </p>
        </div>

        {/* 嵌入服务商 */}
        <div className="space-y-1.5">
          <Label htmlFor="embed-provider">嵌入服务商</Label>
          <Select
            value={embedCfg.provider}
            onValueChange={(v) => setEmbed({ provider: v })}
          >
            <SelectTrigger id="embed-provider" className="w-full">
              <SelectValue placeholder="选择嵌入服务商" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">本地 fastembed（数据不出本机）</SelectItem>
              <SelectItem value="api">云 Embeddings API</SelectItem>
              <SelectItem value="mock">Mock（占位 / 离线兜底）</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 仅 api 时显示 base_url 和 api_key */}
        {embedCfg.provider === "api" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="embed-base-url">Base URL</Label>
              <Input
                id="embed-base-url"
                type="text"
                value={embedCfg.base_url}
                placeholder="https://api.openai.com/v1（留空用默认）"
                onChange={(e) => setEmbed({ base_url: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="embed-api-key">API 密钥</Label>
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
          <Label htmlFor="embed-model">模型</Label>
          <Input
            id="embed-model"
            type="text"
            value={embedCfg.model}
            placeholder="text-embedding-3-small"
            onChange={(e) => setEmbed({ model: e.target.value })}
          />
        </div>

        {/* 重建索引 */}
        <Button
          onClick={rebuildIndex}
          disabled={rebuilding}
          variant="outline"
          size="sm"
        >
          {rebuilding ? "索引中…" : "重建索引"}
        </Button>

        {/* 数据流向说明 */}
        <p className="text-xs text-muted-foreground">
          {embedCfg.provider === "api"
            ? "使用云 API 时，会话片段将发送到配置的云 Embedding 接口；请确认你的隐私设置。"
            : "当前模式（local / mock）全程不出本机，数据仅在本地处理。"}
        </p>
      </section>

      <div className="border-t border-border" />

      {/* ── MCP 接入（让 claude / codex 操作看板与文档） ── */}
      <McpSection />

      <div className="border-t border-border" />

      {/* ── 通知偏好 ── */}
      <NotifyPrefsSection />

      <div className="border-t border-border" />

      {/* ── 数据导出 ── */}
      <ExportSection />

      <div className="border-t border-border" />

      {/* ── 软件更新 ── */}
      <UpdateSection />

      <div className="border-t border-border" />

      {/* ── 后端 / 远程 PB ── */}
      <BackendSection />
    </div>
  );
}
