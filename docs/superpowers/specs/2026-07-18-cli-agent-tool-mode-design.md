# rework CLI 自主工具模式 —— 设计

> 让"服务商 = 本地 CLI（claude / codex）"在开启工具模式时，由 **CLI 自己的 agent 循环**
> 调用它已安装的 MCP 工具（含 rework 自己的 MCP），rework 只把最终文本展示出来。

## 决策纪要（已确认）

| 维度 | 决定 |
|---|---|
| 权限/安全模型 | **完全自动**：claude `--dangerously-skip-permissions`、codex `--dangerously-bypass-approvals-and-sandbox`。CLI 可读写文件/跑命令/调 MCP。 |
| 展示方式 | **仅最终文本**（v1）：复用现有流式管道，把 CLI 最终 stdout 当文本流出，不解析 stream-json 工具过程。 |
| 触发 | AiChatPanel 的「工具模式」开关对 CLI **解禁**；开了且 provider=CLI → 走 CLI 自主 agent 路径。 |
| 非目标 | 不解析/展示工具调用步骤、不做 sandbox 精细化、不限定单一 MCP（用户选了完全自动）。 |

## 关键约束（已核实的外部事实）

- **claude**：`claude -p "<prompt>"` 跑完整 agent；不加权限标志时 headless 遇到工具会挂起/拒绝。
  `--dangerously-skip-permissions`（= `--permission-mode bypassPermissions`）下**所有**工具（含 MCP）自动放行。
  MCP server 从 `~/.claude.json` 自动加载（**不加** `--bare`，否则跳过 MCP 发现）。默认输出即最终文本。
  - 首次使用该标志有**一次性交互警告**需接受；用户已在终端交互用过 claude，通常已接受（风险见下）。
  - Linux/macOS 拒绝以 root 运行（Windows 不受此限）。
- **codex**：`codex exec "<prompt>"` 非交互下调 MCP 工具会因 stdin 关闭被**自动取消**；经核实（openai/codex #24135）
  目前**唯一**可行开关是 `--dangerously-bypass-approvals-and-sandbox`（`--full-auto` 已弃用且不解决此问题）。
  标志放在 `exec` **之后**：`codex exec --dangerously-bypass-approvals-and-sandbox "<prompt>"`。
- **rework MCP 已可一键安装**进两者配置（`mcp_install_claude` / `mcp_install_codex`，本 session 已实现）。
- 现状代码事实：
  - `commands/cli.rs`：`build_cli_command(bin, prompt)` → claude `["-p", prompt]`、codex `["exec", prompt]`；
    `run_cli`（非流式）、`run_cli_stream`（逐行 stdout）。
  - `commands/ai.rs`：`ai_chat_stream` 对 CLI provider 路由到 `run_cli_stream`；`ai_chat_tools` 对 CLI **直接报错**。
  - 前端 `AiChatPanel`：`isCli` 时强制关掉工具模式；`send()` 里 `if (useTools && !isCli) sendWithTools()`。

## 架构总览

只改"CLI 命令构造 + 一个布尔透传"，不新增前端 agent 循环（CLI 自管循环）。

1. **cli.rs**：`build_cli_command` 增加 `with_tools: bool`；为真时按 provider 追加完全自动标志。
   `run_cli` / `run_cli_stream` 增加 `with_tools` 形参并透传。
2. **ai.rs**：`ai_chat_stream` 增加 `with_tools: bool` 参数，CLI 分支透传给 `run_cli_stream`；
   非 CLI 分支忽略该参数（HTTP 流不变）。
3. **前端**：解禁 CLI 的工具开关；`send()` 中 `useTools && isCli` → 走流式并置 `withTools=true`
   （**不**走 `sendWithTools` 的 OpenAI agent 循环）。展示与普通流式一致（最终文本）。

## 详细设计

### 1) cli.rs — 命令构造加工具标志

```rust
/// 构造 CLI 命令。with_tools=true 时追加"完全自动"标志，让 CLI 自主 agent 循环可调用
/// 已配置的 MCP 工具（含 rework MCP）。claude 用 --dangerously-skip-permissions；
/// codex 非交互下 MCP 工具唯一可行开关为 --dangerously-bypass-approvals-and-sandbox（放 exec 之后）。
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
            // claude：-p 一次性 print；工具模式追加权限绕过（MCP 自动放行）
            let mut args = vec!["-p".to_string(), prompt.to_string()];
            if with_tools {
                args.push("--dangerously-skip-permissions".to_string());
            }
            (bin.to_string(), args)
        }
    }
}
```

`run_cli` / `run_cli_stream` 签名各加 `with_tools: bool`，内部 `build_cli_command(bin, &prompt, with_tools)`。
既有非工具调用点传 `false`（行为不变）。

### 2) ai.rs — 流式命令透传 with_tools

`ai_chat_stream` 增参 `with_tools: bool`（serde 默认 false 兼容旧调用）；CLI 分支：
`run_cli_stream(&config.provider, config.cli_path.as_deref(), &messages, with_tools, on_line)`。
非 CLI（HTTP）分支忽略此参数。`ai_chat`（非流式）可同样加 `with_tools` 透传给 `run_cli`（供无流式场景，可选）。

### 3) 前端 — 解禁 CLI 工具开关 + 路由

- 移除"`isCli` 强制关闭工具模式"的逻辑；工具开关对 CLI 可用，旁注"CLI 将自主调用已装 MCP 工具"。
- `send()`：
  ```
  if (useTools && !isCli) { await sendWithTools(...); return; }   // 保持：API provider 的前端 agent 循环
  // CLI（无论是否 useTools）都走流式；useTools 决定是否给后端 withTools
  await streamPath(text, aiConfig, /* withTools = */ useTools && isCli);
  ```
- `ipc.aiChatStream` 增可选 `withTools` 参数，透传给 `invoke("ai_chat_stream", {..., withTools})`。

### 4) 提示词

沿用 `flatten_messages`（system 项目提示 + 历史 + 用户）。工具模式无需额外注入工具说明——
MCP 工具由 CLI 自己发现。可选在 system 末尾补一句"可使用 rework 工具操作看板/文档/阅读"（增量，YAGNI 可不做）。

## 风险与处理

- **claude 首次权限警告**：若该用户从未接受过 `--dangerously-skip-permissions`，headless 可能失败。
  处理：失败信息透传（stderr），提示"请先在终端跑一次 `claude --dangerously-skip-permissions` 接受一次性警告"。
- **完全自动的破坏性**：CLI 可改文件/跑命令。这是用户明确选择；UI 旁注风险提示。工作目录不隐式设定
  （沿用当前 spawn 的进程 cwd）——不在此扩大范围。
- **codex 标志弃用漂移**：`--dangerously-bypass-approvals-and-sandbox` 若未来更名，命令构造集中在
  `build_cli_command`，单点可改；测试覆盖参数装配。
- **超时**：headless agent 可能长跑。v1 不加超时（沿用现有流式，用户可「停止生成」——但 CLI 流当前
  不接取消标志，见既有技术债）。列为后续。

## 测试

- **cli.rs 纯函数**：`build_cli_command` 六例——claude/codex × with_tools(true/false)，断言标志装配与顺序
  （codex 标志在 exec 之后、prompt 之前；claude 标志在 -p prompt 之后）。既有 `builds_claude_command` /
  `builds_codex_command` 更新为传 `false`。
- 前端路由为集成逻辑，手测：CLI + 工具模式 → 让它「新建一个测试任务」→ 看板出现该任务（验证 MCP 生效）。

## 依赖与前置

- 无新 crate、无新 npm 依赖。
- 需 rework MCP 已安装进 claude/codex（设置页一键）。
- Rust 改动需 `cargo build` 重建 app 才能实测。

## 非目标（YAGNI）

- 不解析 stream-json 展示工具调用步骤（v1 仅最终文本）。
- 不做 sandbox/allowlist 精细权限（用户选完全自动）。
- 不为 CLI 流接入取消标志（既有技术债，另计）。
- 不改 `ai_chat_tools`（API provider 的前端 agent 循环）路径。
