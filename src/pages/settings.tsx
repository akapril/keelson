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
export default function Settings() {
  const { hotkey, workspacePath, loading, error, load, saveHotkey } =
    useSettingsStore();

  // AI 助手配置（受控，来源于 store，写入即持久化 localStorage）
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const setAiConfig = useSettingsStore((s) => s.setAiConfig);

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

  /** 更新嵌入配置并同步写入 localStorage */
  function setEmbed(patch: Partial<EmbedConfig>) {
    setEmbedCfgState((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem("rework-embed-config", JSON.stringify(next));
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
                </>
              )}

              {/* 模型名称（CLI provider 保留，CLI 会忽略或按自身默认） */}
              <div className="space-y-1.5">
                <Label htmlFor="ai-model">模型</Label>
                <Input
                  id="ai-model"
                  type="text"
                  value={aiConfig.model}
                  placeholder="gpt-4o-mini / claude-3-5-sonnet-..."
                  onChange={(e) => setAiConfig({ model: e.target.value })}
                />
              </div>

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
