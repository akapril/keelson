// @vitest-environment jsdom
// 注意：.test.tsx 文件必须在文件头写 // @vitest-environment jsdom，
// 否则会静默用 node 环境失败（vitest.config.ts 默认 environment 为 "node"）。
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock Tauri APIs（AiChatPanel 依赖链会触发 Tauri invoke）
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock IPC（AiChatPanel 内部调用 ipc.aiCancelStream 等）
vi.mock("@/lib/tauri/ipc", () => ({
  ipc: {
    aiChatStream: vi.fn().mockResolvedValue(undefined),
    aiCancelStream: vi.fn().mockResolvedValue(undefined),
    aiChatTools: vi.fn().mockResolvedValue({ kind: "text", content: "", tool_calls: [] }),
  },
}));

// Mock react-router-dom（AiChatPanel 调用 useNavigate）
vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
}));

// Mock settings store
vi.mock("@/store/settings", () => ({
  useSettingsStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      aiConfig: { provider: "openai", api_key: "test-key", model: "gpt-4o" },
    }),
  ),
}));

// Mock board store
vi.mock("@/store/board", () => ({
  useBoardStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ states: [], tasks: [], createTask: vi.fn(), updateTask: vi.fn() }),
  ),
}));

// Mock docs store
vi.mock("@/store/docs", () => ({
  useDocsStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ createDoc: vi.fn(), updateDoc: vi.fn() }),
  ),
}));

// Mock prompt insert（避免 PB 副作用）
vi.mock("@/features/prompts/usePromptInsert", () => ({
  usePromptInsert: vi.fn(() => ({
    input: "",
    onKeyDown: vi.fn(() => false),
    overlay: null,
    button: null,
  })),
}));

// Mock project-context（避免 PB 副作用）
vi.mock("../../features/ai/project-context", () => ({
  buildProjectContext: vi.fn().mockResolvedValue(""),
}));

// Mock Markdown 组件（避免 markdown 解析依赖）
vi.mock("@/components/markdown", () => ({
  Markdown: ({ content }: { content: string }) => <span>{content}</span>,
}));

import i18n from "../index";
import { AiChatPanel } from "@/features/ai/AiChatPanel";

function renderPanel() {
  render(
    <AiChatPanel
      projectId="test-project-id"
      projectName="TestProject"
    />,
  );
}

describe("AiChatPanel i18n – ai 命名空间", () => {
  afterEach(async () => {
    cleanup();
    // 复原为中文，避免污染后续用例
    await i18n.changeLanguage("zh");
  });

  it("默认中文：空白提示包含项目名", async () => {
    await i18n.changeLanguage("zh");
    renderPanel();
    expect(screen.getByText(/TestProject/)).toBeInTheDocument();
    expect(screen.getByText(/AI 助手提问/)).toBeInTheDocument();
  });

  it("默认中文：发送按钮文本为「发送」", async () => {
    await i18n.changeLanguage("zh");
    renderPanel();
    expect(screen.getByRole("button", { name: /发送/ })).toBeInTheDocument();
  });

  it("默认中文：包含上下文复选框标签正确", async () => {
    await i18n.changeLanguage("zh");
    renderPanel();
    expect(screen.getByText(/包含项目上下文/)).toBeInTheDocument();
  });

  it("默认中文：工具模式复选框标签正确", async () => {
    await i18n.changeLanguage("zh");
    renderPanel();
    expect(screen.getByText(/工具模式/)).toBeInTheDocument();
  });

  it("默认中文：输入框 placeholder 含「输入消息」", async () => {
    await i18n.changeLanguage("zh");
    renderPanel();
    const textarea = screen.getByPlaceholderText(/输入消息/);
    expect(textarea).toBeInTheDocument();
  });

  it("切换英文：发送按钮文本为「Send」", async () => {
    await i18n.changeLanguage("en");
    renderPanel();
    expect(screen.getByRole("button", { name: /Send/ })).toBeInTheDocument();
  });

  it("切换英文：输入框 placeholder 含「Type a message」", async () => {
    await i18n.changeLanguage("en");
    renderPanel();
    const textarea = screen.getByPlaceholderText(/Type a message/);
    expect(textarea).toBeInTheDocument();
  });

  it("切换英文：包含上下文标签含「Include project context」", async () => {
    await i18n.changeLanguage("en");
    renderPanel();
    expect(screen.getByText(/Include project context/)).toBeInTheDocument();
  });

  it("切换英文：工具模式标签含「Tool mode」", async () => {
    await i18n.changeLanguage("en");
    renderPanel();
    expect(screen.getByText(/Tool mode/)).toBeInTheDocument();
  });

  it("英文键值非空（ai.chat.send 有翻译）", () => {
    const val = i18n.t("chat.send", { ns: "ai", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("chat.send");
  });

  it("英文键值非空（ai.chat.stop 有翻译）", () => {
    const val = i18n.t("chat.stop", { ns: "ai", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("chat.stop");
  });

  it("英文键值非空（ai.chat.clear 有翻译）", () => {
    const val = i18n.t("chat.clear", { ns: "ai", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("chat.clear");
  });

  it("英文键值非空（ai.chat.noConfigTitle 有翻译）", () => {
    const val = i18n.t("chat.noConfigTitle", { ns: "ai", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("chat.noConfigTitle");
  });

  it("英文键值非空（ai.chat.toolLimitReached 有翻译）", () => {
    const val = i18n.t("chat.toolLimitReached", { ns: "ai", lng: "en" });
    expect(val).toBeTruthy();
    expect(val).not.toBe("chat.toolLimitReached");
  });

  it("中文插值正确（ai.chat.emptyHint 含项目名）", () => {
    const val = i18n.t("chat.emptyHint", { ns: "ai", lng: "zh", projectName: "Rework" });
    expect(val).toContain("Rework");
    expect(val).toContain("AI 助手");
  });

  it("英文插值正确（ai.chat.emptyHint 含项目名）", () => {
    const val = i18n.t("chat.emptyHint", { ns: "ai", lng: "en", projectName: "Rework" });
    expect(val).toContain("Rework");
    expect(val).toBeTruthy();
  });

  it("中文插值正确（ai.chat.requestError 含消息）", () => {
    const val = i18n.t("chat.requestError", { ns: "ai", lng: "zh", msg: "超时" });
    expect(val).toBe("请求失败：超时");
  });

  it("英文插值正确（ai.chat.requestError 含消息）", () => {
    const val = i18n.t("chat.requestError", { ns: "ai", lng: "en", msg: "timeout" });
    expect(val).toContain("timeout");
    expect(val).toBeTruthy();
  });

  it("zh/en key 结构对称（所有 zh key 在 en 中都存在）", () => {
    const zhKeys = Object.keys(
      (i18n.getResourceBundle("zh", "ai") as Record<string, Record<string, string>>)?.chat ?? {},
    );
    const enKeys = Object.keys(
      (i18n.getResourceBundle("en", "ai") as Record<string, Record<string, string>>)?.chat ?? {},
    );
    expect(zhKeys.sort()).toEqual(enKeys.sort());
  });
});
