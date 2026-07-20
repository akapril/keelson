//! MCP 读会话工具：list_sessions / search_sessions / get_session。
//! 让外部 claude/codex 读本机历史会话记忆（只读）。上下文取自 AppState
//! （sessions 缓存 / Tantivy 索引 / provider 注册表），复用 commands::sessions 的后端逻辑。
use super::registry::{opt_str, require_str, ToolDef};
use crate::models::Session;
use crate::AppState;
use serde_json::{json, Value};

/// 判断工具名是否属于「读会话」工具集（server 层据此路由到本模块而非 board 分发）。
pub fn is_session_tool(name: &str) -> bool {
    matches!(name, "list_sessions" | "search_sessions" | "get_session")
}

/// 3 个只读会话工具的 schema（与 board 工具合并暴露给 tools/list）。
pub fn session_tool_schemas() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "list_sessions",
            description: "列出本机历史 AI-CLI 会话摘要（跨 claude/codex）。可选 repo_path 过滤到某仓库；按更新时间倒序，limit 默认 50。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "repo_path": { "type": "string", "description": "仓库绝对路径（等于会话 project_path）；省略则返回全部" },
                    "limit": { "type": "integer", "description": "最多返回条数，默认 50" }
                }
            }),
        },
        ToolDef {
            name: "search_sessions",
            description: "全文检索历史会话（覆盖全部用户消息，按相关度排序），返回命中片段。用它回答『我上次怎么处理 X 的』。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": "integer", "description": "最多返回条数，默认 20" }
                },
                "required": ["query"]
            }),
        },
        ToolDef {
            name: "get_session",
            description: "读取指定会话的完整时间线消息（transcript）。provider 为 claude 或 codex，session_id 来自 list_sessions / search_sessions。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "provider": { "type": "string", "enum": ["claude", "codex"] },
                    "session_id": { "type": "string" }
                },
                "required": ["provider", "session_id"]
            }),
        },
    ]
}

/// 纯逻辑：把会话列表按 repo_path 过滤、updated_at 倒序、截断 limit，投影为摘要 JSON。
/// 抽成纯函数便于单测（不依赖 AppState / IO）。
pub fn summarize_sessions(sessions: &[Session], repo_path: Option<&str>, limit: usize) -> Vec<Value> {
    let mut picked: Vec<&Session> = sessions
        .iter()
        .filter(|s| repo_path.map_or(true, |rp| s.project_path == rp))
        .collect();
    // updated_at 倒序（最近在前）
    picked.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    picked
        .into_iter()
        .take(limit)
        .map(|s| {
            json!({
                "session_id": s.session_id,
                "provider": s.provider,
                "project_name": s.project_name,
                "project_path": s.project_path,
                "first_prompt": s.first_prompt,
                "last_prompt": s.last_prompt,
                "message_count": s.message_count,
                "updated_at": s.updated_at.to_rfc3339(),
            })
        })
        .collect()
}

/// 单次返回条数上限（防外部不可信 limit 诱发大分配；与前端 SEARCH_LIMIT 对齐）。
const MAX_LIMIT: usize = 200;

/// 分发读会话工具。上下文为 &AppState（server 层经 self.app.state 取得）。
/// 复用 commands::sessions 的后端：sessions 缓存 / session_backend::search / reg.read_timeline。
/// 注：async 仅为与 handler 形态统一——三个分支内部均同步，无 .await（故 parking_lot guard 不跨 await）。
pub async fn dispatch_session(name: &str, args: Value, state: &AppState) -> Result<Value, String> {
    match name {
        "list_sessions" => {
            let repo = opt_str(&args, "repo_path");
            let limit = (args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize).min(MAX_LIMIT);
            let sessions = state.sessions.lock().clone();
            Ok(json!(summarize_sessions(&sessions, repo.as_deref(), limit)))
        }
        "search_sessions" => {
            let query = require_str(&args, "query")?;
            let limit = (args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize).min(MAX_LIMIT);
            let guard = state.index.lock();
            match guard.as_ref() {
                Some(idx) => Ok(json!(crate::search::session_backend::search(idx, &query, limit))),
                // 索引未就绪（应用仍在建索引）：对外部 agent 明确报错，避免它把空数组误读为"无相关会话"
                None => Err("会话全文索引尚未就绪（应用仍在建索引），请稍后重试".into()),
            }
        }
        "get_session" => {
            let provider = require_str(&args, "provider")?;
            let sid = require_str(&args, "session_id")?;
            match state.reg.by_id(&provider) {
                Some(p) => Ok(json!(p.read_timeline(&sid))),
                None => Err(format!("未知 provider：{provider}")),
            }
        }
        other => Err(format!("未知会话工具：{other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn make_session(id: &str, path: &str, updated_secs: i64) -> Session {
        Session {
            session_id: id.to_string(),
            provider: "claude".to_string(),
            project_path: path.to_string(),
            project_name: path.split('/').last().unwrap_or("").to_string(),
            first_prompt: "first".to_string(),
            last_prompt: "last".to_string(),
            created_at: Utc.timestamp_opt(0, 0).unwrap(),
            updated_at: Utc.timestamp_opt(updated_secs, 0).unwrap(),
            message_count: 3,
            user_messages: Vec::new(),
            total_tokens: 0,
            by_model: Default::default(),
        }
    }

    #[test]
    fn schemas_cover_three_session_tools() {
        let names: Vec<&str> = session_tool_schemas().iter().map(|t| t.name).collect();
        assert_eq!(session_tool_schemas().len(), 3);
        for n in ["list_sessions", "search_sessions", "get_session"] {
            assert!(names.contains(&n), "缺少 {n}");
        }
        for t in session_tool_schemas() {
            assert_eq!(t.input_schema["type"], "object");
            assert!(t.input_schema.get("properties").is_some());
        }
    }

    #[test]
    fn is_session_tool_discriminates() {
        assert!(is_session_tool("list_sessions"));
        assert!(is_session_tool("search_sessions"));
        assert!(is_session_tool("get_session"));
        assert!(!is_session_tool("list_tasks")); // board 工具
        assert!(!is_session_tool("create_doc"));
        assert!(!is_session_tool("nope"));
    }

    #[test]
    fn summarize_empty_yields_empty() {
        assert!(summarize_sessions(&[], None, 50).is_empty());
    }

    #[test]
    fn summarize_sorts_desc_and_truncates() {
        let sessions = vec![
            make_session("old", "/p/a", 1000),
            make_session("new", "/p/a", 3000),
            make_session("mid", "/p/a", 2000),
        ];
        let out = summarize_sessions(&sessions, None, 2);
        assert_eq!(out.len(), 2); // 截断
        // 倒序：new(3000) 在前、mid(2000) 次之
        assert_eq!(out[0]["session_id"], "new");
        assert_eq!(out[1]["session_id"], "mid");
    }

    #[test]
    fn summarize_filters_by_repo_path() {
        let sessions = vec![
            make_session("a", "/p/a", 1000),
            make_session("b", "/p/b", 2000),
        ];
        let out = summarize_sessions(&sessions, Some("/p/b"), 50);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["session_id"], "b");
    }

    #[test]
    fn summarize_projects_expected_fields() {
        let out = summarize_sessions(&[make_session("s1", "/p/a", 1000)], None, 50);
        let r = &out[0];
        for k in ["session_id", "provider", "project_name", "project_path", "first_prompt", "last_prompt", "message_count", "updated_at"] {
            assert!(r.get(k).is_some(), "投影缺字段 {k}");
        }
        assert_eq!(r["message_count"], 3);
    }

    // ── dispatch 层：参数校验与错误分支（AppState::default 造空 state，不触真实会话文件）──

    #[tokio::test]
    async fn dispatch_search_requires_query() {
        let st = crate::AppState::default();
        let r = dispatch_session("search_sessions", json!({}), &st).await;
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("query"));
    }

    #[tokio::test]
    async fn dispatch_get_session_requires_provider_and_id() {
        let st = crate::AppState::default();
        // 缺 provider
        assert!(dispatch_session("get_session", json!({ "session_id": "x" }), &st)
            .await
            .is_err());
        // 缺 session_id
        assert!(dispatch_session("get_session", json!({ "provider": "claude" }), &st)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn dispatch_get_session_unknown_provider_errors() {
        let st = crate::AppState::default();
        let r = dispatch_session(
            "get_session",
            json!({ "provider": "notaprovider", "session_id": "x" }),
            &st,
        )
        .await;
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("未知 provider"));
    }

    #[tokio::test]
    async fn dispatch_list_sessions_empty_state_ok_empty() {
        let st = crate::AppState::default();
        let r = dispatch_session("list_sessions", json!({}), &st).await.unwrap();
        assert!(r.as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn dispatch_unknown_tool_errors() {
        let st = crate::AppState::default();
        let r = dispatch_session("nope", json!({}), &st).await;
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("未知会话工具"));
    }
}
