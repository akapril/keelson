# P0 本地 CLI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 rework 的 AI 对话可直接使用本机已安装的 `claude` / `codex` CLI（走用户的订阅、全程不出本机），作为除 OpenAI/Anthropic API 之外的新 provider。

**Architecture:** 复用现有 `AiConfig{provider,base_url,api_key,model}` 结构，新增两个 provider 取值 `"claude-cli"`、`"codex-cli"`。后端不走 tauri-plugin-shell（其 capability scope 对任意命令限制过严），改用 `tokio::process::Command` 直接 spawn PATH 上的 CLI。把多轮消息压平成单个 prompt 文本喂给 `claude -p` / `codex exec`；非流式用 `.output()`，流式逐行读 stdout 经 Tauri Channel 推送。前端设置页新增两个 provider 选项，并对 CLI provider 隐藏 base_url/api_key 字段。

**Tech Stack:** Rust (tokio::process, serde_json), Tauri v2 Channel, React 19 + TS, zustand。

## Global Constraints

- 注释与日志默认中文（源自 CLAUDE.md）。
- 不新增第三方 crate —— `tokio` 已启用 `features=["full"]`（含 process），`serde_json`、`chrono` 已在。
- 后端 provider 分发现状为 `let is_anthropic = config.provider == "anthropic";`（`ai.rs:86` 等）——CLI 分支必须在此之前短路，避免误入 HTTP 路径。
- Windows 上 `claude`/`codex` 常为 `.cmd`；spawn 需按平台解析可执行名。
- CLI provider 不需要 api_key —— 前端不得因 api_key 为空而拦截发送（现 `AiChatPanel.send` 有 `if (!aiConfig.api_key) setNeedConfig`）。
- 只读会话、写文件等既有安全约束不变；本计划不触碰会话扫描/PB。

---

### Task 1: 后端 CLI 执行模块（纯逻辑 + 进程调用）

**Files:**
- Create: `src-tauri/src/commands/cli.rs`
- Modify: `src-tauri/src/commands/mod.rs`（新增 `pub mod cli;`）

**Interfaces:**
- Consumes: `crate::commands::ai::ChatMessage`（`{role:String, content:String}`，见 `ai.rs`）。
- Produces:
  - `pub fn is_cli_provider(provider: &str) -> bool`
  - `pub fn cli_bin_for(provider: &str) -> Option<&'static str>` → `"claude-cli"→"claude"`, `"codex-cli"→"codex"`
  - `pub fn flatten_messages(messages: &[ChatMessage]) -> String`
  - `pub fn build_cli_command(bin: &str, prompt: &str) -> (String, Vec<String>)` — 返回 (可执行名, 参数)；claude→`["-p", prompt]`，codex→`["exec", prompt]`
  - `pub async fn run_cli(provider: &str, messages: &[ChatMessage]) -> Result<String, String>`
  - `pub async fn run_cli_stream(provider, messages, on_line: impl FnMut(String)) -> Result<(), String>`

- [ ] **Step 1: 写失败测试**（纯逻辑：provider 判定、bin 映射、消息压平、命令构造）

在 `src-tauri/src/commands/cli.rs` 末尾追加：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::ai::ChatMessage;

    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage { role: role.into(), content: content.into() }
    }

    #[test]
    fn detects_cli_providers() {
        assert!(is_cli_provider("claude-cli"));
        assert!(is_cli_provider("codex-cli"));
        assert!(!is_cli_provider("openai"));
        assert!(!is_cli_provider("anthropic"));
    }

    #[test]
    fn maps_provider_to_bin() {
        assert_eq!(cli_bin_for("claude-cli"), Some("claude"));
        assert_eq!(cli_bin_for("codex-cli"), Some("codex"));
        assert_eq!(cli_bin_for("openai"), None);
    }

    #[test]
    fn flattens_messages_with_role_labels() {
        let out = flatten_messages(&[
            msg("system", "你是助手"),
            msg("user", "问题一"),
            msg("assistant", "回答一"),
            msg("user", "问题二"),
        ]);
        // system 作为前缀说明；user/assistant 带角色标注；最后是最新 user
        assert!(out.contains("你是助手"));
        assert!(out.contains("问题一"));
        assert!(out.contains("回答一"));
        assert!(out.trim_end().ends_with("问题二"));
    }

    #[test]
    fn builds_claude_command() {
        let (bin, args) = build_cli_command("claude", "hello");
        assert_eq!(bin, "claude");
        assert_eq!(args, vec!["-p".to_string(), "hello".to_string()]);
    }

    #[test]
    fn builds_codex_command() {
        let (bin, args) = build_cli_command("codex", "hello");
        assert_eq!(bin, "codex");
        assert_eq!(args, vec!["exec".to_string(), "hello".to_string()]);
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test cli::tests -- --nocapture`
Expected: 编译失败（`cli` 模块/函数未定义）。

- [ ] **Step 3: 实现模块**

`src-tauri/src/commands/cli.rs` 顶部写入实现（放在 tests 之前）：

```rust
//! 本地 CLI provider：直接调用本机 `claude` / `codex` 可执行文件进行对话。
//! 不走 tauri-plugin-shell（capability scope 限制），用 tokio::process 直接 spawn PATH 上的 CLI。
use crate::commands::ai::ChatMessage;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// 判断 provider 是否为本地 CLI 类型。
pub fn is_cli_provider(provider: &str) -> bool {
    cli_bin_for(provider).is_some()
}

/// provider 取值 → 可执行文件基名。
pub fn cli_bin_for(provider: &str) -> Option<&'static str> {
    match provider {
        "claude-cli" => Some("claude"),
        "codex-cli" => Some("codex"),
        _ => None,
    }
}

/// 把多轮消息压平成单个 prompt 文本：system 作为顶部说明，其余按「角色：内容」逐行。
/// CLI 是单轮 prompt 接口，无原生多轮，故用文本模拟上下文。
pub fn flatten_messages(messages: &[ChatMessage]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for m in messages {
        let text = m.content.trim();
        if text.is_empty() {
            continue;
        }
        match m.role.as_str() {
            "system" => parts.push(text.to_string()),
            "assistant" => parts.push(format!("助手：{text}")),
            _ => parts.push(format!("用户：{text}")),
        }
    }
    parts.join("\n\n")
}

/// 构造 CLI 命令：claude 用 `-p <prompt>`，codex 用 `exec <prompt>`。
pub fn build_cli_command(bin: &str, prompt: &str) -> (String, Vec<String>) {
    match bin {
        "codex" => (bin.to_string(), vec!["exec".to_string(), prompt.to_string()]),
        // 默认按 claude：-p 走一次性 print 模式
        _ => (bin.to_string(), vec!["-p".to_string(), prompt.to_string()]),
    }
}

/// 平台化解析可执行名：Windows 下 CLI 常为 .cmd，返回候选列表按序尝试。
fn bin_candidates(bin: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![format!("{bin}.cmd"), format!("{bin}.exe"), bin.to_string()]
    } else {
        vec![bin.to_string()]
    }
}

/// 非流式：spawn CLI，等待结束，返回 stdout 文本。
pub async fn run_cli(provider: &str, messages: &[ChatMessage]) -> Result<String, String> {
    let bin = cli_bin_for(provider).ok_or_else(|| format!("未知 CLI provider：{provider}"))?;
    let prompt = flatten_messages(messages);
    let (_b, args) = build_cli_command(bin, &prompt);

    let mut last_err = String::new();
    for cand in bin_candidates(bin) {
        match Command::new(&cand).args(&args).output().await {
            Ok(output) => {
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
                }
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("{bin} 退出码非零：{}", stderr.trim()));
            }
            Err(e) => last_err = format!("无法启动 {cand}：{e}"),
        }
    }
    Err(format!("{last_err}（请确认已安装 {bin} 并在 PATH 中）"))
}

/// 流式：逐行读 stdout，每读到一行调用 on_line 回调。
pub async fn run_cli_stream<F: FnMut(String)>(
    provider: &str,
    messages: &[ChatMessage],
    mut on_line: F,
) -> Result<(), String> {
    use std::process::Stdio;
    let bin = cli_bin_for(provider).ok_or_else(|| format!("未知 CLI provider：{provider}"))?;
    let prompt = flatten_messages(messages);
    let (_b, args) = build_cli_command(bin, &prompt);

    let mut last_err = String::new();
    for cand in bin_candidates(bin) {
        let spawned = Command::new(&cand)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        match spawned {
            Ok(mut child) => {
                let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    on_line(line);
                }
                let status = child.wait().await.map_err(|e| e.to_string())?;
                if !status.success() {
                    return Err(format!("{bin} 退出码非零"));
                }
                return Ok(());
            }
            Err(e) => last_err = format!("无法启动 {cand}：{e}"),
        }
    }
    Err(format!("{last_err}（请确认已安装 {bin} 并在 PATH 中）"))
}
```

在 `src-tauri/src/commands/mod.rs` 新增模块声明（跟随 `pub mod ai;` 之后）：

```rust
pub mod cli; // 本地 CLI provider（claude / codex）
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src-tauri && cargo test cli::tests`
Expected: 5 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands/cli.rs src-tauri/src/commands/mod.rs
git commit -m "feat(cli): 新增本地 CLI provider 执行模块（claude/codex，纯逻辑已测）"
```

---

### Task 2: 把 CLI provider 接入 ai_chat / ai_chat_stream 分发

**Files:**
- Modify: `src-tauri/src/commands/ai.rs`（`ai_chat` 开头 ~L86；`ai_chat_stream` 开头 ~L435）

**Interfaces:**
- Consumes: `crate::commands::cli::{is_cli_provider, run_cli, run_cli_stream}`。
- Produces: 无新签名（复用现有命令）。

- [ ] **Step 1: 在 `ai_chat` 入口短路 CLI**

在 `ai_chat` 函数体最前（`let is_anthropic = ...` 之前）插入：

```rust
    // 本地 CLI provider：直接调用 claude/codex，绕过 HTTP。
    if crate::commands::cli::is_cli_provider(&config.provider) {
        return crate::commands::cli::run_cli(&config.provider, &messages).await;
    }
```

- [ ] **Step 2: 在 `ai_chat_stream` 入口短路 CLI**

在 `ai_chat_stream` 函数体最前（组装 URL/body 之前、注册取消标志之后均可，但需在 HTTP 逻辑之前）插入。注意 `on_event` 为 `tauri::ipc::Channel<AiStreamEvent>`，delta 事件形如 `AiStreamEvent{kind:"delta", text:Some(...)}`，结束用 `kind:"done"`：

```rust
    // 本地 CLI provider：逐行读取 stdout，按 delta 事件推送；不复用 HTTP 取消标志。
    if crate::commands::cli::is_cli_provider(&config.provider) {
        let result = crate::commands::cli::run_cli_stream(
            &config.provider,
            &messages,
            |line| {
                let _ = on_event.send(AiStreamEvent {
                    kind: "delta".into(),
                    text: Some(format!("{line}\n")),
                });
            },
        )
        .await;
        match result {
            Ok(()) => {
                let _ = on_event.send(AiStreamEvent { kind: "done".into(), text: None });
                return Ok(());
            }
            Err(e) => {
                let _ = on_event.send(AiStreamEvent { kind: "error".into(), text: Some(e) });
                return Ok(());
            }
        }
    }
```

> 若 `AiStreamEvent` 字段名/构造与上不符，以 `ai.rs` 中现有 `on_event.send(...)` 调用处的写法为准，照抄其字段。

- [ ] **Step 3: 编译校验**

Run: `cd src-tauri && cargo build`
Expected: 编译通过（无 warning-as-error）。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/commands/ai.rs
git commit -m "feat(ai): ai_chat/ai_chat_stream 分发本地 CLI provider"
```

---

### Task 3: 前端类型与设置页 provider 选项

**Files:**
- Modify: `src/types/ai.ts`（`AiProvider` 联合类型 L2）
- Modify: `src/pages/settings.tsx`（provider `Select` L267-280；base_url/model/api_key 字段 L290-322）
- Modify: `src/features/ai/AiChatPanel.tsx`（`send` 的 api_key 拦截 L128-132）

**Interfaces:**
- Consumes: 无。
- Produces: `AiProvider` 增加 `"claude-cli" | "codex-cli"`。

- [ ] **Step 1: 扩展 AiProvider 类型**

`src/types/ai.ts` L2：

```typescript
export type AiProvider = "openai" | "anthropic" | "claude-cli" | "codex-cli";
```

- [ ] **Step 2: 设置页新增 provider 选项**

`src/pages/settings.tsx` 的 `<SelectContent>`（L275-279）内追加两项：

```tsx
      <SelectItem value="openai">OpenAI 兼容</SelectItem>
      <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
      <SelectItem value="claude-cli">Claude Code（本地 CLI）</SelectItem>
      <SelectItem value="codex-cli">Codex（本地 CLI）</SelectItem>
```

- [ ] **Step 3: CLI provider 隐藏 base_url/api_key，给出说明**

在 settings.tsx 中，先于「Base URL / API Key」字段块（约 L282-322）加一个布尔：

```tsx
  // 本地 CLI provider 无需 base_url / api_key
  const isCliProvider =
    aiConfig.provider === "claude-cli" || aiConfig.provider === "codex-cli";
```

用 `{!isCliProvider && ( ... )}` 包裹 Base URL 与 API Key 两个字段块。并在其后追加 CLI 说明（当 `isCliProvider` 为真时显示）：

```tsx
      {isCliProvider && (
        <p className="text-xs text-muted-foreground">
          将调用本机已安装的{" "}
          <code>{aiConfig.provider === "codex-cli" ? "codex" : "claude"}</code>{" "}
          命令行（走你的本地订阅，数据不出本机）。请确保它已安装并在 PATH 中。
        </p>
      )}
```

Model 字段对 CLI 可保留（CLI 会忽略或按自身默认），无需改。

- [ ] **Step 4: 放开 AiChatPanel 对 CLI 的 api_key 拦截**

`src/features/ai/AiChatPanel.tsx` `send`（L128-132）改为：

```tsx
    const aiConfig = useSettingsStore.getState().aiConfig;
    // CLI provider 无需 api_key；其余 provider 仍要求密钥
    const isCli =
      aiConfig.provider === "claude-cli" || aiConfig.provider === "codex-cli";
    if (!isCli && !aiConfig.api_key) {
      setNeedConfig(true);
      return;
    }
```

- [ ] **Step 5: 前端类型检查**

Run: `npm run build`（或 `npx tsc --noEmit`）
Expected: 通过，无类型错误。

- [ ] **Step 6: 提交**

```bash
git add src/types/ai.ts src/pages/settings.tsx src/features/ai/AiChatPanel.tsx
git commit -m "feat(fe): 设置页新增本地 CLI provider（claude/codex），对话放开 CLI 的 key 拦截"
```

---

### Task 4: 端到端手动验证

**Files:** 无（手动验证）。

- [ ] **Step 1: 构建并运行**

Run: `npm run tauri dev`（若 `pocketbase.exe` 锁定 target，先 `taskkill //F //IM pocketbase.exe`，切勿杀 rework*）
Expected: 应用启动。

- [ ] **Step 2: 验证**

1. 设置页选「Claude Code（本地 CLI）」→ base_url/api_key 字段消失，出现 CLI 说明。
2. 进入任一项目「AI 助手」，发送「用一句话介绍你自己」。
3. 预期：逐行流式渲染出 claude CLI 的回复；失败时气泡显示「请确认已安装 claude…」而非静默。
4. 切「Codex（本地 CLI）」重复。

- [ ] **Step 3: 记录结果**

在 PR/提交说明里记录两种 CLI 的实测结果（成功/报错文案）。若某 CLI 未装，说明其报错路径已验证。

---

## Self-Review 摘要

- Spec 覆盖：新增 provider（claude-cli/codex-cli）✓ Task1-3；设置页 provider ✓ Task3；隐私（本机执行）✓ 架构决定用 tokio::process 直连。
- 无占位符：所有步骤含实际代码与命令。
- 类型一致：`is_cli_provider`/`cli_bin_for`/`run_cli`/`run_cli_stream` 跨 Task1→Task2 命名一致；前端 `AiProvider` 取值与后端 `cli_bin_for` 的 match 键一致（`"claude-cli"`/`"codex-cli"`）。
- 风险备注：`AiStreamEvent` 字段名以 ai.rs 现有 `on_event.send` 处为准（Task2 Step2 已注明照抄）。
