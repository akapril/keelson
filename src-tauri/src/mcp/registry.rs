//! 工具注册表：8 个工具的 JSON Schema + 参数校验助手。纯逻辑,可测。
//! 分发在 tools.rs 的 dispatch()（需 PB 上下文,故与 handler 同处）。
use serde_json::{json, Value};

/// 一个工具的元信息（名称 + 描述 + 入参 JSON Schema）。
pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
}

/// 取必填字符串参数；缺失或非字符串返回中文错误。
pub fn require_str(args: &Value, key: &str) -> Result<String, String> {
    match args.get(key).and_then(|v| v.as_str()) {
        Some(s) => Ok(s.to_string()),
        None => Err(format!("缺少必填参数「{key}」（需为字符串）")),
    }
}

/// 取可选字符串参数。
pub fn opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

const PRIORITIES: [&str; 5] = ["none", "low", "medium", "high", "urgent"];

/// 8 个工具的 schema。均需显式 project_id（MCP 无"当前项目"概念）。
pub fn tool_schemas() -> Vec<ToolDef> {
    let project_id = json!({ "type": "string", "description": "看板项目 id（来自 list_projects）" });
    vec![
        ToolDef {
            name: "list_projects",
            description: "列出当前用户的所有看板项目（返回 id 与名称）。建/查任务前先调它拿 project_id。",
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "list_states",
            description: "列出指定项目的状态列（建任务时选目标列）。返回 id、名称、类别。",
            input_schema: json!({ "type": "object", "properties": { "project_id": project_id }, "required": ["project_id"] }),
        },
        ToolDef {
            name: "list_tasks",
            description: "列出指定项目的所有任务（含 id、标题、所在状态列、优先级、截止日期）。",
            input_schema: json!({ "type": "object", "properties": { "project_id": project_id }, "required": ["project_id"] }),
        },
        ToolDef {
            name: "create_task",
            description: "在指定项目创建任务。state_id 来自 list_states。可选 enqueue=true 直接派 agent 后台自主执行。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "project_id": project_id,
                    "state_id": { "type": "string", "description": "目标状态列 id" },
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "priority": { "type": "string", "enum": PRIORITIES },
                    "due_date": { "type": "string", "description": "截止日期，如 2026-08-01" },
                    "agent_provider": { "type": "string", "description": "配合 enqueue：自主执行的 CLI（claude / codex）" },
                    "enqueue": { "type": "boolean", "description": "true=建后立即入队派 agent 后台自主执行（会真实起进程、在隔离 worktree 改代码、产出可审阅的分支，供人工合并/打回）" }
                },
                "required": ["project_id", "state_id", "title"]
            }),
        },
        ToolDef {
            name: "update_task",
            description: "更新任务字段（task_id 来自 list_tasks），只传要改的字段。可选 enqueue=true 派 agent 后台自主执行。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "priority": { "type": "string", "enum": PRIORITIES },
                    "state_id": { "type": "string", "description": "移动到的目标状态列 id" },
                    "due_date": { "type": "string" },
                    "agent_provider": { "type": "string", "description": "配合 enqueue：自主执行的 CLI（claude / codex）" },
                    "enqueue": { "type": "boolean", "description": "true=入队派 agent 后台自主执行（会真实起进程、在隔离 worktree 改代码、产出可审阅的分支）" }
                },
                "required": ["task_id"]
            }),
        },
        ToolDef {
            name: "list_docs",
            description: "列出指定项目的文档（含 id 与标题）。",
            input_schema: json!({ "type": "object", "properties": { "project_id": project_id }, "required": ["project_id"] }),
        },
        ToolDef {
            name: "get_doc",
            description: "读取单篇文档全文（doc_id 来自 list_docs）。改文档前先 get_doc 拿到 content，再 update_doc 写回，避免盲覆盖。",
            input_schema: json!({ "type": "object", "properties": { "doc_id": { "type": "string" } }, "required": ["doc_id"] }),
        },
        ToolDef {
            name: "create_doc",
            description: "在指定项目创建文档（Markdown 正文可选）。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "project_id": project_id,
                    "title": { "type": "string" },
                    "content": { "type": "string", "description": "Markdown 正文" }
                },
                "required": ["project_id", "title"]
            }),
        },
        ToolDef {
            name: "update_doc",
            description: "更新文档标题或正文（doc_id 来自 list_docs）。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "doc_id": { "type": "string" },
                    "title": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["doc_id"]
            }),
        },
        ToolDef {
            name: "search_memory",
            description: "检索用户的记忆账本（跨 claude/codex 会话提炼的事实/偏好/决策/约定）。开工前用它了解用户的长期偏好与项目约定，避免重复问、少走弯路。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "关键词，匹配记忆内容；省略返回全部" },
                    "kind": { "type": "string", "enum": ["fact", "preference", "decision", "convention"] },
                    "scope": { "type": "string", "enum": ["global", "project"] },
                    "limit": { "type": "integer", "description": "最多返回，默认 20" }
                }
            }),
        },
        ToolDef {
            name: "create_memory",
            description: "把一条值得长期复用的经验写入用户的记忆账本（事实/偏好/决策/约定）。默认进「待审」，需用户在 rework 里采纳后才生效，不会污染账本。仅记一句话断言级别的长期知识，不要记临时上下文。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "content": { "type": "string", "description": "一句话断言（长期可复用的事实/偏好/决策/约定）" },
                    "kind": { "type": "string", "enum": ["fact", "preference", "decision", "convention"], "description": "粒度类别，默认 fact" },
                    "scope": { "type": "string", "enum": ["global", "project"], "description": "global=全局；project=仅本项目（默认 project，需 project_id）" },
                    "project_id": { "type": "string", "description": "scope=project 时必填，来自 list_projects" }
                },
                "required": ["content"]
            }),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn schemas_cover_all_tools() {
        let names: Vec<&str> = tool_schemas().iter().map(|t| t.name).collect();
        for expected in [
            "list_projects", "list_states", "list_tasks", "create_task",
            "update_task", "list_docs", "get_doc", "create_doc", "update_doc",
            "search_memory", "create_memory",
        ] {
            assert!(names.contains(&expected), "缺少工具 {expected}");
        }
        assert_eq!(tool_schemas().len(), 11);
    }

    #[test]
    fn each_schema_is_object_with_properties() {
        for t in tool_schemas() {
            assert_eq!(t.input_schema["type"], "object", "{} schema 非 object", t.name);
            assert!(t.input_schema.get("properties").is_some(), "{} 缺 properties", t.name);
        }
    }

    #[test]
    fn require_str_extracts_or_errors() {
        let args = json!({ "title": "hello", "n": 5 });
        assert_eq!(require_str(&args, "title").unwrap(), "hello");
        assert!(require_str(&args, "missing").is_err());
        assert!(require_str(&args, "n").is_err()); // 非字符串
    }

    #[test]
    fn opt_str_returns_none_when_absent() {
        let args = json!({ "title": "x" });
        assert_eq!(opt_str(&args, "title"), Some("x".to_string()));
        assert_eq!(opt_str(&args, "missing"), None);
    }
}
