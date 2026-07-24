//! mcp/intercept.rs —— 「透明自动托管」：Claude Code 的 PreToolUse(Bash) hook 经内联 curl
//! POST 到 /intercept 端点。后端判断命令是否长驻进程，是则连进程内 daemon(:19191) 把它
//! 托管起来，并返回 PreToolUse `deny` 决策挡回原 Bash（避免 Claude 又直接跑一遍未托管的）。
//!
//! 与 /activity 同架构：内联 curl + HTTP 端点 + Bearer 鉴权，零外部脚本、零二进制。
//! 判断逻辑移植自 claude-runtime 的 intercept-long-running hook。
use serde_json::{json, Value};
use std::sync::OnceLock;

/// 长驻进程「正向」正则（命中任一即候选长驻）。移植自 claude-runtime intercept-long-running。
fn positive_patterns() -> &'static [regex::Regex] {
    static P: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    P.get_or_init(|| {
        [
            r"(?i)(npm|pnpm|yarn|npx|bunx)\s+(run\s+)?(dev|start|serve|preview)",
            r"(?i)python[3]?\s+\S+\.py",
            r"(?i)(uvicorn|gunicorn|flask\s+run|fastapi|streamlit)",
            r"(?i)node\s+\S+\.(js|ts|mjs)",
            r"(?i)docker\s+compose\s+up",
            r"(?i)(vite|next\s+dev|nuxt\s+dev)",
        ]
        .iter()
        .filter_map(|p| regex::Regex::new(p).ok())
        .collect()
    })
}

/// 「负向」正则（命中即排除，视为一次性命令，不托管）。
fn negative_patterns() -> &'static [regex::Regex] {
    static N: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    N.get_or_init(|| {
        [
            r"(?i)(build|test|install|check|lint|format|compile|init|create|add|remove)",
            r"claude-runtime", // 已是 claude-runtime 命令，别再套一层
        ]
        .iter()
        .filter_map(|p| regex::Regex::new(p).ok())
        .collect()
    })
}

/// 判断一条命令是否为「应托管的长驻进程」：命中正向且未命中负向。
/// 纯函数，便于单测。
pub fn is_long_running_command(cmd: &str) -> bool {
    if cmd.trim().is_empty() {
        return false;
    }
    if negative_patterns().iter().any(|re| re.is_match(cmd)) {
        return false;
    }
    positive_patterns().iter().any(|re| re.is_match(cmd))
}

/// 从命令派生一个可读、稳定的进程名：runner + 首个内容词，清洗为 [a-z0-9_-]。
/// 例："npm run dev"→"npm-dev"；"python main.py"→"python-main-py"；"vite"→"vite"。
/// 纯函数，便于单测。
pub fn derive_process_name(cmd: &str) -> String {
    let toks: Vec<&str> = cmd.split_whitespace().collect();
    let runner = toks.first().copied().unwrap_or("proc");
    // 跳过常见子命令/占位词，取第一个「内容词」
    let skip = ["run", "compose", "-m", "exec"];
    let content = toks
        .iter()
        .skip(1)
        .find(|t| !skip.contains(*t) && !t.starts_with('-'));
    let raw = match content {
        Some(c) => format!("{runner}-{c}"),
        None => runner.to_string(),
    };
    // 清洗：非 [a-zA-Z0-9_-] 一律换 '-'，折叠连续 '-'，去首尾 '-'，小写，截断 40。
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch.to_ascii_lowercase());
            prev_dash = ch == '-';
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let out = out.trim_matches('-').chars().take(40).collect::<String>();
    if out.is_empty() {
        "proc".to_string()
    } else {
        out
    }
}

/// 放行决策：返回空对象，Claude Code 视作无干预、正常执行工具。
fn allow() -> Value {
    json!({})
}

/// 拦截决策：PreToolUse `deny`，把 reason 反馈给 Claude（它会看到并停手）。
fn deny(reason: String) -> Value {
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    })
}

/// 处理一条 PreToolUse hook payload，返回给 hook（curl stdout）的决策 JSON。
/// 非 Bash / 非长驻 → 放行；长驻 → 连 daemon 托管并 deny 挡回。
/// daemon 未运行或出错 → 放行（优雅降级，不阻塞用户干活）。
pub async fn handle_intercept(payload: Value) -> Value {
    // 只管 Bash 工具
    let tool = payload.get("tool_name").and_then(|v| v.as_str()).unwrap_or("");
    if tool != "Bash" {
        return allow();
    }
    let command = payload
        .get("tool_input")
        .and_then(|i| i.get("command"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if !is_long_running_command(&command) {
        return allow();
    }
    let cwd = payload
        .get("cwd")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // 会话溯源：PreToolUse payload 带 session_id（Claude Code hook）→ 记进程起自哪次会话。
    let session_id = payload.get("session_id").and_then(|v| v.as_str());
    let name = derive_process_name(&command);

    // 直接调进程内进程管理托管（无 TCP）。返回 JSON：成功含 id/pid，失败含 error。
    let result =
        crate::commands::runtime::daemon_start(&command, &name, &cwd, session_id, Some("claude"))
            .await;
    match result.get("error").and_then(|v| v.as_str()) {
        // 托管成功 → 挡回原 Bash，告知 Claude 进程已起
        None => deny(format!(
            "长驻进程已由 rework 托管为「{name}」（后台运行，端口/日志见 rework「进程」标签）。\
             请勿再直接运行；如需停止/查看请到「进程」标签。"
        )),
        // 已存在同名 → 视为已在托管，同样挡回
        Some(e) if e.contains("已存在") => deny(format!(
            "进程「{name}」已在 rework 托管中，无需重复启动（日志见「进程」标签）。"
        )),
        // 其它错误 → 放行（不阻塞：进程直接跑，只是不被托管）
        Some(_) => allow(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_long_running() {
        for c in [
            "npm run dev",
            "pnpm dev",
            "yarn start",
            "npx vite",
            "python main.py",
            "python3 app.py",
            "uvicorn app:app --reload",
            "node server.js",
            "docker compose up",
            "vite",
            "next dev",
        ] {
            assert!(is_long_running_command(c), "{c} 应判为长驻");
        }
    }

    #[test]
    fn excludes_oneshot_and_negatives() {
        for c in [
            "npm install",
            "npm run build",
            "npm test",
            "pnpm lint",
            "cargo build",
            "git status",
            "ls -la",
            "claude-runtime start \"npm run dev\" --name x",
            "",
        ] {
            assert!(!is_long_running_command(c), "{c} 不应判为长驻");
        }
    }

    #[test]
    fn derive_name_examples() {
        assert_eq!(derive_process_name("npm run dev"), "npm-dev");
        assert_eq!(derive_process_name("pnpm dev"), "pnpm-dev");
        assert_eq!(derive_process_name("python main.py"), "python-main-py");
        assert_eq!(derive_process_name("vite"), "vite");
        assert_eq!(derive_process_name("next dev"), "next-dev");
        assert_eq!(derive_process_name(""), "proc");
    }

    #[test]
    fn allow_and_deny_shapes() {
        assert_eq!(allow(), json!({}));
        let d = deny("x".into());
        assert_eq!(d["hookSpecificOutput"]["permissionDecision"], "deny");
        assert_eq!(d["hookSpecificOutput"]["hookEventName"], "PreToolUse");
    }
}
