//! 默认队友的幂等预置 + 现有任务回填。
//! 放在 Rust bootstrap（非 JS 迁移）：迁移期 local-user 尚未创建，无 owner 可引用；
//! 且默认队友需可被用户编辑（owner="" 会因 updateRule 只读）。
use crate::pb::client::PbClient;
use serde_json::json;

/// 预置的默认队友定义：(name, emoji, color 键, provider)。
/// color 用 providers.ts 的色板键（前端据此取 chip/dot 类）。
const DEFAULT_AGENTS: &[(&str, &str, &str, &str)] = &[
    ("Claude", "🤖", "amber", "claude"),
    ("Codex",  "⚡", "sky",   "codex"),
];

/// 幂等预置默认队友 + 首次回填。owner 已有任一 agent_profiles → 直接返回（视为已初始化）。
pub async fn ensure_default_agents(client: &PbClient, owner_id: &str) {
    // 幂等守卫：查该 owner 是否已有 agent_profiles（含软删也算已初始化，避免重复播种）
    let filter = format!("owner = \"{}\"", owner_id.replace('"', ""));
    match client.list("agent_profiles", &filter, "id").await {
        Ok(rows) if !rows.is_empty() => return, // 已初始化
        Ok(_) => {}
        Err(e) => {
            eprintln!("[keelson] 查询 agent_profiles 失败（跳过预置，非致命）: {e}");
            return;
        }
    }

    // 建两个默认队友，记录 provider → 新建 id 映射，供回填
    let mut provider_to_id: Vec<(String, String)> = Vec::new();
    for (name, emoji, color, provider) in DEFAULT_AGENTS {
        let created = client
            .create("agent_profiles", &json!({
                "owner":       owner_id,
                "name":        name,
                "emoji":       emoji,
                "color":       color,
                "provider":    provider,
                "with_tools":  true,
                "auto_commit": false,
            }))
            .await;
        match created {
            Ok(rec) => {
                if let Some(id) = rec["id"].as_str() {
                    provider_to_id.push(((*provider).to_string(), id.to_string()));
                }
            }
            Err(e) => eprintln!("[keelson] 预置默认队友 {name} 失败（非致命）: {e}"),
        }
    }

    // 首次回填：现有 agent_provider 非空但 agent_id 空的任务 → 设为对应 provider 的默认队友 id
    let bf_filter = "agent_provider != \"\" && agent_id = \"\" && deleted_at = \"\"";
    let tasks = match client.list("board_tasks", bf_filter, "id,agent_provider").await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[keelson] 回填 agent_id 查询失败（非致命）: {e}");
            return;
        }
    };
    for t in tasks {
        let (Some(tid), Some(prov)) = (t["id"].as_str(), t["agent_provider"].as_str()) else { continue };
        if let Some((_, aid)) = provider_to_id.iter().find(|(p, _)| p == prov) {
            let _ = client
                .patch("board_tasks", tid, &json!({ "agent_id": aid }))
                .await;
        }
    }
}
