# CLI 自主工具模式 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 逐任务实现本计划。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 让 provider=CLI 且开工具模式时，claude/codex 用自身 agent 循环 + 已装 MCP（含 rework MCP）自主调用工具，rework 只展示最终文本。

**Architecture:** 只在"CLI 命令构造"追加完全自动标志 + 一个 `with_tools` 布尔从前端透传到 `build_cli_command`。不新增前端 agent 循环（CLI 自管循环）。

**Tech Stack:** Rust（tokio::process）、Tauri command、React/TS。

## Global Constraints

- 完全自动权限：claude `--dangerously-skip-permissions`；codex `--dangerously-bypass-approvals-and-sandbox`（放 `exec` 之后、prompt 之前）。
- 仅最终文本展示（复用现有流式管道），不解析 stream-json。
- 既有非工具调用点行为不得改变（`with_tools=false` 等价旧行为）。
- 注释/日志中文；不硬编码主题色（本任务无 UI 颜色）。
- 不改 `ai_chat_tools`（API provider 前端 agent 循环）路径。
- Rust 改动需 `cargo build` 重建才实测；`cargo check` 需先杀 `pocketbase*` 释放构建锁（勿杀 `rework*`）。

---

### Task 1: cli.rs —— build_cli_command 加 with_tools + 透传

**Files:**
- Modify: `src-tauri/src/commands/cli.rs`
- Test: 同文件 `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `build_cli_command(bin: &str, prompt: &str, with_tools: bool) -> (String, Vec<String>)`；
  `run_cli(provider, cli_path, messages, with_tools)`；
  `run_cli_stream(provider, cli_path, messages, with_tools, on_line)`。

- [ ] **Step 1: 更新既有测试为新签名并加工具标志用例（先失败）**

替换 `builds_claude_command` / `builds_codex_command`，新增工具模式用例：

```rust
#[test]
fn builds_claude_command_plain() {
    let (bin, args) = build_cli_command("claude", "hello", false);
    assert_eq!(bin, "claude");
    assert_eq!(args, vec!["-p".to_string(), "hello".to_string()]);
}

#[test]
fn builds_claude_command_with_tools() {
    let (_bin, args) = build_cli_command("claude", "hello", true);
    // 权限绕过标志追加在 -p prompt 之后
    assert_eq!(
        args,
        vec!["-p".to_string(), "hello".to_string(), "--dangerously-skip-permissions".to_string()]
    );
}

#[test]
fn builds_codex_command_plain() {
    let (bin, args) = build_cli_command("codex", "hello", false);
    assert_eq!(bin, "codex");
    assert_eq!(args, vec!["exec".to_string(), "hello".to_string()]);
}

#[test]
fn builds_codex_command_with_tools() {
    let (_bin, args) = build_cli_command("codex", "hello", true);
    // 标志在 exec 之后、prompt 之前
    assert_eq!(
        args,
        vec![
            "exec".to_string(),
            "--dangerously-bypass-approvals-and-sandbox".to_string(),
            "hello".to_string()
        ]
    );
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test --lib cli:: 2>&1 | tail`
Expected: 编译失败（`build_cli_command` 参数不匹配）。

- [ ] **Step 3: 实现 build_cli_command 加 with_tools**

```rust
/// 构造 CLI 命令。with_tools=true 时追加"完全自动"标志，让 CLI 自主 agent 循环可调用
/// 已配置的 MCP 工具（含 rework MCP）。
/// claude：--dangerously-skip-permissions（bypassPermissions，MCP 自动放行）。
/// codex：非交互下 MCP 工具唯一可行开关为 --dangerously-bypass-approvals-and-sandbox，且须放 exec 之后。
pub fn build_cli_command(bin: &str, prompt: &str, with_tools: bool) -> (String, Vec<String>) {
    match bin {
        "codex" => {
            let mut args = vec!["exec".to_string()];
            if with_tools {
                args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
            }
            args.push(prompt.to_string());
            (bin.to_string(), args)
        }
        _ => {
            let mut args = vec!["-p".to_string(), prompt.to_string()];
            if with_tools {
                args.push("--dangerously-skip-permissions".to_string());
            }
            (bin.to_string(), args)
        }
    }
}
```

- [ ] **Step 4: run_cli / run_cli_stream 加 with_tools 形参并透传**

两函数签名各加 `with_tools: bool`（放 `messages` 之后），内部调用改为
`build_cli_command(bin, &prompt, with_tools)`。其余不变。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd src-tauri && cargo test --lib cli:: 2>&1 | tail`
Expected: 全部 PASS（含新 4 例）。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/commands/cli.rs
git commit -m "feat(cli): build_cli_command 加 with_tools，追加完全自动标志(claude/codex)"
```

---

### Task 2: ai.rs —— ai_chat_stream 透传 with_tools 给 CLI

**Files:**
- Modify: `src-tauri/src/commands/ai.rs`（`ai_chat_stream`，约 466；CLI 分支约 474）

**Interfaces:**
- Consumes: Task 1 的 `run_cli_stream(..., with_tools, on_line)`。
- Produces: `ai_chat_stream(config, messages, stream_id, on_event, with_tools, state)` 命令新增 `with_tools: bool` 参数（前端传 `withTools`）。

- [ ] **Step 1: 给 ai_chat_stream 增参并透传**

在参数列表加 `with_tools: bool`（放 `on_event` 之后、`state` 之前）。CLI 分支的
`run_cli_stream(&config.provider, config.cli_path.as_deref(), &messages, |line| {...})`
改为传入 `with_tools`：

```rust
let result = crate::commands::cli::run_cli_stream(
    &config.provider,
    config.cli_path.as_deref(),
    &messages,
    with_tools,
    |line| {
        let _ = on_event.send(AiStreamEvent {
            kind: "delta".into(),
            text: Some(format!("{line}\n")),
        });
    },
)
.await;
```

非 CLI（HTTP）分支不使用 `with_tools`，保持不变（`ai_stream_run` 签名不动）。

- [ ] **Step 2: 同步 ai_chat（非流式）CLI 分支**

`ai_chat` 命令的 CLI 分支调用 `run_cli(&config.provider, config.cli_path.as_deref(), &messages)`
改为传 `false`（非流式路径暂不接工具模式；仅保证签名一致编译通过）。

- [ ] **Step 3: cargo check 通过**

Run: `taskkill //F //IM pocketbase.exe 2>/dev/null; cd src-tauri && cargo check 2>&1 | tail`
Expected: 0 errors（允许既有 `secret` 无关 warning）。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/commands/ai.rs
git commit -m "feat(ai): ai_chat_stream 透传 with_tools 给 CLI 自主 agent 路径"
```

---

### Task 3: 前端 —— 解禁 CLI 工具开关 + 路由 withTools

**Files:**
- Modify: `src/lib/tauri/ipc.ts`（`aiChatStream` 增 `withTools`）
- Modify: `src/features/ai/AiChatPanel.tsx`（解禁 CLI 工具开关；`send()` 路由）

**Interfaces:**
- Consumes: Task 2 的 `ai_chat_stream` 新增 `withTools` 参数。

- [ ] **Step 1: ipc.aiChatStream 增 withTools 参数**

```ts
aiChatStream: (
  config: AiConfig,
  messages: AiChatMessage[],
  streamId: string,
  onEvent: (ev: AiStreamEvent) => void,
  withTools = false,
) => {
  const channel = new Channel<AiStreamEvent>();
  channel.onmessage = onEvent;
  return invoke<void>("ai_chat_stream", {
    config,
    messages,
    streamId,
    onEvent: channel,
    withTools,
  });
},
```

- [ ] **Step 2: AiChatPanel 解禁 CLI 工具开关**

移除"`isCli` 强制关闭工具模式"的逻辑（让工具开关对 CLI 可勾选）。在工具开关旁的说明文案对 CLI
补一句："CLI 将自主调用已装的 MCP 工具（完全自动，可能读写文件/跑命令）。" 保留 API provider 原说明。

- [ ] **Step 3: send() 路由**

```ts
// API provider + 工具模式：前端 agent 循环（不变）
if (useTools && !isCli) {
  await sendWithTools(text, aiConfig);
  return;
}
// 其余（含 CLI）走流式；CLI 且开工具模式时给后端 withTools=true → CLI 自管 agent+MCP
// ...在调用 ipc.aiChatStream 处传入第 5 参 (useTools && isCli)
```

找到 `send()` 里调用 `ipc.aiChatStream(aiConfig, reqMsgs, streamId, onEvent)` 处，
追加第 5 实参 `useTools && isCli`。

- [ ] **Step 4: tsc 通过**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: No errors found。

- [ ] **Step 5: 提交**

```bash
git add src/lib/tauri/ipc.ts src/features/ai/AiChatPanel.tsx
git commit -m "feat(ai-chat): 解禁 CLI 工具模式，路由 withTools 到 CLI 自主 agent"
```

---

## 广审 & 手测（全部任务后）

- 广审：`cargo check` + `npx tsc` + `npx vitest run`（55 应仍绿）。
- 手测（需 `cargo build` 重建 + rework MCP 已装）：设置 provider=claude-cli/codex-cli → 开工具模式 →
  「帮我在看板新建一个叫『CLI工具测试』的任务」→ 看板出现该任务（验证 CLI 自主调 rework MCP 生效）。
- 失败排查：claude 首次需终端跑一次 `claude --dangerously-skip-permissions` 接受一次性警告。
