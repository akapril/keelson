//! 把 agent_ref（agent_id 优先，回退当 provider）解析为执行所需的队友属性。
use crate::pb::client::PbClient;

/// 该 agent 未设 max_concurrent 时的默认并发（worker 用；此处仅解析用不到，留常量共享语义）。
pub const DEFAULT_MAX_CONCURRENT: u64 = 1;

/// 解析后的队友执行属性。
pub struct ResolvedAgent {
    pub provider: String,
    pub instructions: String,
    pub skills: Vec<String>,
    pub skill_text: String,
    pub timeout_secs: Option<u64>,
    pub with_tools: bool,
    pub auto_commit: bool,
    /// 命中队友时为 Some(agent_id)，回退 provider 时为 None（run.agent 据此写）。
    pub agent_id: Option<String>,
}

/// agent_ref 命中 agent_profiles.id → 取其属性；否则把 agent_ref 当原始 provider（S1 兼容），其余取默认。
pub async fn resolve_agent(client: &PbClient, agent_ref: &str) -> ResolvedAgent {
    let filter = format!("id = \"{}\"", agent_ref.replace('"', ""));
    let fields = "id,provider,instructions,skill_prompts,skill_text,timeout_secs,with_tools,auto_commit";
    let hit = client
        .list("agent_profiles", &filter, fields)
        .await
        .ok()
        .and_then(|rows| rows.into_iter().next());

    let Some(rec) = hit else {
        // 回退：agent_ref 当原始 provider（S1 直跑/旧数据）
        return ResolvedAgent {
            provider: agent_ref.to_string(),
            instructions: String::new(),
            skills: Vec::new(),
            skill_text: String::new(),
            timeout_secs: None,
            with_tools: true,
            auto_commit: false,
            agent_id: None,
        };
    };

    // 拉绑定技能内容（skill_prompts 是 prompt id 数组）→ 按序取 prompts.content
    let skill_ids: Vec<String> = rec["skill_prompts"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let mut skills = Vec::new();
    if !skill_ids.is_empty() {
        // 单次 OR 查询取内容；保持 skill_ids 顺序
        let or = skill_ids.iter()
            .map(|id| format!("id = \"{}\"", id.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" || ");
        if let Ok(rows) = client.list("prompts", &or, "id,content").await {
            for id in &skill_ids {
                if let Some(r) = rows.iter().find(|r| r["id"].as_str() == Some(id)) {
                    let c = r["content"].as_str().unwrap_or_default();
                    if !c.trim().is_empty() { skills.push(c.to_string()); }
                }
            }
        }
    }

    // number 字段：>0 才视为覆盖，否则用默认（None=全局超时；with_tools 缺省 true）
    let to = rec["timeout_secs"].as_f64().map(|n| n as u64).filter(|&n| n > 0);
    let with_tools = rec["with_tools"].as_bool().unwrap_or(true);
    let auto_commit = rec["auto_commit"].as_bool().unwrap_or(false);

    ResolvedAgent {
        provider: rec["provider"].as_str().unwrap_or_default().to_string(),
        instructions: rec["instructions"].as_str().unwrap_or_default().to_string(),
        skills,
        skill_text: rec["skill_text"].as_str().unwrap_or_default().to_string(),
        timeout_secs: to,
        with_tools,
        auto_commit,
        agent_id: Some(agent_ref.to_string()),
    }
}
