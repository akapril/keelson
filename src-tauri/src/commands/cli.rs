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
            .stderr(Stdio::null()) // 丢弃 stderr，避免缓冲区满导致死锁
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
