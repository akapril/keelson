//! 本地 CLI provider：直接调用本机 `claude` / `codex` 可执行文件进行对话。
//! 不走 tauri-plugin-shell（capability scope 限制），用 tokio::process 直接 spawn PATH 上的 CLI。
use crate::commands::ai::ChatMessage;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
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

/// 构造 CLI 命令。**prompt 不进命令行参数**，而是经 stdin 传入——避免超长 prompt
/// 触发 Windows 命令行长度上限（os error 206「文件名或扩展名太长」）。
/// - claude：`-p`（无 prompt 参数时读 stdin）。
/// - codex：`exec -`（`-` 占位表示 stdin 即完整 prompt）。
/// with_tools=true（工具模式）追加「完全自动」标志：
/// - claude：`--dangerously-skip-permissions`；
/// - codex：`--dangerously-bypass-approvals-and-sandbox`（放 `exec` 之后）。
/// stream=true（流式路径）时，claude 用 stream-json 事件输出（含部分消息增量），
/// 让前端实时看到思考/工具/正文增量，而非结束才一次性吐全文。codex 的 exec 无此开关，忽略。
pub fn build_cli_command(bin: &str, with_tools: bool, stream: bool) -> (String, Vec<String>) {
    match bin {
        "codex" => {
            let mut args = vec!["exec".to_string()];
            if with_tools {
                args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
            }
            args.push("-".to_string()); // stdin 作为完整 prompt
            (bin.to_string(), args)
        }
        // 默认按 claude：-p 一次性 print 模式，无 prompt 参数则读 stdin
        _ => {
            let mut args = vec!["-p".to_string()];
            if stream {
                // 流式事件输出 + 部分消息增量（逐 token / 工具活动实时可见）
                args.push("--output-format".to_string());
                args.push("stream-json".to_string());
                args.push("--verbose".to_string());
                args.push("--include-partial-messages".to_string());
            }
            if with_tools {
                args.push("--dangerously-skip-permissions".to_string());
            }
            (bin.to_string(), args)
        }
    }
}

/// 解析 claude stream-json 的一行事件，抽出要展示的文本片段：
/// - `content_block_delta` 的 `text_delta` → 正文增量；
/// - `content_block_start` 的 `tool_use` → 一行工具活动提示（让「思考/动作」可见）。
/// 其它事件（system/assistant/result/user）返回 None，避免与增量重复计数。纯函数、可测。
pub fn claude_stream_piece(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("type")?.as_str()? != "stream_event" {
        return None;
    }
    let ev = v.get("event")?;
    match ev.get("type")?.as_str()? {
        "content_block_delta" => {
            let d = ev.get("delta")?;
            match d.get("type")?.as_str()? {
                "text_delta" => d.get("text")?.as_str().map(|s| s.to_string()),
                _ => None,
            }
        }
        "content_block_start" => {
            let cb = ev.get("content_block")?;
            if cb.get("type")?.as_str()? == "tool_use" {
                let name = cb.get("name").and_then(|n| n.as_str()).unwrap_or("tool");
                Some(format!("\n\n🔧 {name}\n"))
            } else {
                None
            }
        }
        _ => None,
    }
}

/// 从 claude 的 `result` 事件抽最终文本——作为「全程没收到任何增量」时的兜底
/// （如 claude 版本不支持 --include-partial-messages）。纯函数、可测。
pub fn claude_result_text(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("type")?.as_str()? != "result" {
        return None;
    }
    v.get("result")?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// 平台化解析可执行名：Windows 下 CLI 常为 .cmd，返回候选列表按序尝试。
fn bin_candidates(bin: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![format!("{bin}.cmd"), format!("{bin}.exe"), bin.to_string()]
    } else {
        vec![bin.to_string()]
    }
}

/// 解析可执行候选：用户显式配置了命令路径则优先（绝对路径绕过 PATH，
/// 解决 GUI 进程 PATH 与交互式 shell 不一致导致的 "program not found"）；
/// 否则回退按平台猜测的候选名（依赖进程 PATH）。
fn candidates_for(bin: &str, cli_path: Option<&str>) -> Vec<String> {
    match cli_path {
        Some(p) if !p.trim().is_empty() => vec![p.trim().to_string()],
        _ => bin_candidates(bin),
    }
}

/// 在给定候选可执行名上构造 Command：设定 args、三管道，并在 cwd 非空时切工作目录。
/// cwd = 项目仓库路径 → 让 claude/codex 在对应项目目录下运行（能看到项目文件）。
fn build_process(cand: &str, args: &[String], cwd: Option<&str>) -> Command {
    let mut c = Command::new(cand);
    c.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(d) = cwd {
        if !d.trim().is_empty() {
            c.current_dir(d);
        }
    }
    c
}

/// 非流式：spawn CLI，等待结束，返回 stdout 文本。
/// `cli_path` 为用户在设置里填的绝对路径（可选），优先于 PATH 查找。
/// `cwd` 为项目仓库路径（可选）：非空则在该目录下运行 CLI。
pub async fn run_cli(
    provider: &str,
    cli_path: Option<&str>,
    cwd: Option<&str>,
    messages: &[ChatMessage],
    with_tools: bool,
) -> Result<String, String> {
    let bin = cli_bin_for(provider).ok_or_else(|| format!("未知 CLI provider：{provider}"))?;
    let prompt = flatten_messages(messages);
    // 非流式：claude 用普通 -p 文本输出（stream=false）
    let (_b, args) = build_cli_command(bin, with_tools, false);

    let mut last_err = String::new();
    for cand in candidates_for(bin, cli_path) {
        let spawned = build_process(&cand, &args, cwd).spawn();
        match spawned {
            Ok(mut child) => {
                // prompt 经 stdin 传入并关闭（发送 EOF，避免 codex 挂等输入）
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(prompt.as_bytes()).await;
                    let _ = stdin.shutdown().await;
                }
                let output = child.wait_with_output().await.map_err(|e| e.to_string())?;
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
                }
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("{bin} 退出码非零：{}", stderr.trim()));
            }
            Err(e) => last_err = format!("无法启动 {cand}：{e}"),
        }
    }
    Err(format!(
        "{last_err}（请确认已安装 {bin}，或在设置里填写「命令路径」为其绝对路径 —— GUI 进程的 PATH 可能与终端不同）"
    ))
}

/// 流式：逐行读 stdout。claude 走 stream-json（解析出正文增量/工具活动）；
/// codex 原样逐行透传。`on_line` 收到的是「可直接追加到气泡」的文本片段（claude 已含所需换行）。
/// `cwd`=项目仓库路径（可选），非空则在该目录运行 CLI。
pub async fn run_cli_stream<F: FnMut(String)>(
    provider: &str,
    cli_path: Option<&str>,
    cwd: Option<&str>,
    messages: &[ChatMessage],
    with_tools: bool,
    mut on_line: F,
) -> Result<(), String> {
    let bin = cli_bin_for(provider).ok_or_else(|| format!("未知 CLI provider：{provider}"))?;
    let prompt = flatten_messages(messages);
    // 流式：claude 用 stream-json（stream=true）；codex 忽略该开关
    let (_b, args) = build_cli_command(bin, with_tools, true);
    let is_claude = bin == "claude";

    let mut last_err = String::new();
    for cand in candidates_for(bin, cli_path) {
        let spawned = build_process(&cand, &args, cwd).spawn();
        match spawned {
            Ok(mut child) => {
                // prompt 经 stdin 传入并关闭（避免超长命令行 + codex 挂等 EOF）
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(prompt.as_bytes()).await;
                    let _ = stdin.shutdown().await;
                }
                let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
                // 并发抽干 stderr：避免其管道缓冲写满阻塞子进程（原先 null 丢弃即为规避此死锁）
                let stderr = child.stderr.take();
                let stderr_task = tokio::spawn(async move {
                    let mut buf = String::new();
                    if let Some(se) = stderr {
                        let _ = BufReader::new(se).read_to_string(&mut buf).await;
                    }
                    buf
                });
                let mut reader = BufReader::new(stdout).lines();
                // claude 流式兜底：若全程没有增量文本（版本不支持 partial），用 result 事件文本
                let mut got_text = false;
                let mut result_fallback: Option<String> = None;
                while let Ok(Some(line)) = reader.next_line().await {
                    if is_claude {
                        if let Some(piece) = claude_stream_piece(&line) {
                            got_text = true;
                            on_line(piece);
                        } else if let Some(r) = claude_result_text(&line) {
                            result_fallback = Some(r);
                        }
                        // 其它事件忽略
                    } else {
                        // codex：原样逐行（补换行，保持可读分行）
                        on_line(format!("{line}\n"));
                    }
                }
                if is_claude && !got_text {
                    if let Some(r) = result_fallback {
                        on_line(r);
                    }
                }
                let status = child.wait().await.map_err(|e| e.to_string())?;
                let errtext = stderr_task.await.unwrap_or_default();
                if !status.success() {
                    let se = errtext.trim();
                    return Err(if se.is_empty() {
                        format!("{bin} 退出码非零")
                    } else {
                        format!("{bin} 退出码非零：{se}")
                    });
                }
                return Ok(());
            }
            Err(e) => last_err = format!("无法启动 {cand}：{e}"),
        }
    }
    Err(format!(
        "{last_err}（请确认已安装 {bin}，或在设置里填写「命令路径」为其绝对路径 —— GUI 进程的 PATH 可能与终端不同）"
    ))
}

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
    fn explicit_cli_path_overrides_candidates() {
        // 显式绝对路径 → 单一候选，绕过 PATH 猜测
        assert_eq!(
            candidates_for("codex", Some("C:/tools/codex.cmd")),
            vec!["C:/tools/codex.cmd".to_string()]
        );
        // 空白路径 / None → 回退平台候选
        assert_eq!(candidates_for("codex", Some("   ")), bin_candidates("codex"));
        assert_eq!(candidates_for("codex", None), bin_candidates("codex"));
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
    fn builds_claude_command_plain() {
        // prompt 不进 args（经 stdin 传）；非流式 claude -p 无参读 stdin
        let (bin, args) = build_cli_command("claude", false, false);
        assert_eq!(bin, "claude");
        assert_eq!(args, vec!["-p".to_string()]);
    }

    #[test]
    fn builds_claude_command_with_tools() {
        let (_bin, args) = build_cli_command("claude", true, false);
        assert_eq!(
            args,
            vec!["-p".to_string(), "--dangerously-skip-permissions".to_string()]
        );
    }

    #[test]
    fn builds_claude_command_stream() {
        // 流式：追加 stream-json 事件输出 + 部分消息增量
        let (_bin, args) = build_cli_command("claude", false, true);
        assert_eq!(
            args,
            vec![
                "-p".to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
                "--include-partial-messages".to_string(),
            ]
        );
    }

    #[test]
    fn builds_codex_command_plain() {
        // codex exec -  （- 占位表示 stdin 即完整 prompt）；stream 开关对 codex 无效
        let (bin, args) = build_cli_command("codex", false, true);
        assert_eq!(bin, "codex");
        assert_eq!(args, vec!["exec".to_string(), "-".to_string()]);
    }

    #[test]
    fn builds_codex_command_with_tools() {
        // 标志在 exec 之后、- 之前
        let (_bin, args) = build_cli_command("codex", true, false);
        assert_eq!(
            args,
            vec![
                "exec".to_string(),
                "--dangerously-bypass-approvals-and-sandbox".to_string(),
                "-".to_string(),
            ]
        );
    }

    #[test]
    fn claude_stream_piece_extracts_text_delta() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}}"#;
        assert_eq!(claude_stream_piece(line), Some("你好".to_string()));
    }

    #[test]
    fn claude_stream_piece_marks_tool_use() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","name":"Edit"}}}"#;
        let p = claude_stream_piece(line).unwrap();
        assert!(p.contains("Edit") && p.contains("🔧"));
    }

    #[test]
    fn claude_stream_piece_ignores_other_events() {
        assert_eq!(
            claude_stream_piece(r#"{"type":"assistant","message":{"content":[]}}"#),
            None
        );
        assert_eq!(claude_stream_piece(r#"{"type":"system","subtype":"init"}"#), None);
        assert_eq!(claude_stream_piece("非 JSON"), None);
    }

    #[test]
    fn claude_result_text_extracts_final() {
        let line = r#"{"type":"result","subtype":"success","result":"最终答案","is_error":false}"#;
        assert_eq!(claude_result_text(line), Some("最终答案".to_string()));
        // 非 result 事件返回 None
        assert_eq!(claude_result_text(r#"{"type":"assistant"}"#), None);
    }

    #[test]
    fn bin_candidates_platform_order() {
        let c = bin_candidates("claude");
        #[cfg(windows)]
        assert_eq!(c, vec!["claude.cmd".to_string(), "claude.exe".to_string(), "claude".to_string()]);
        #[cfg(not(windows))]
        assert_eq!(c, vec!["claude".to_string()]);
        assert!(c.contains(&"claude".to_string()));
    }
}
