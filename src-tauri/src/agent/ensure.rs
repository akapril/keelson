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

/// 幂等预置默认队友 + 任务回填。
///
/// 改为按 provider 逐个 ensure，解决部分播种锁死问题：
/// - 首次运行：两个 provider 均无记录 → 全部创建。
/// - 部分播种（如 Claude 成功 Codex 失败）：下次启动 Claude 跳过，Codex 补建，自愈。
/// - 用户主动软删除：含软删的行仍能匹配 owner&&provider → 跳过，不重建，尊重用户意图。
pub async fn ensure_default_agents(client: &PbClient, owner_id: &str) {
    // 安全转义 owner，避免 PB filter 注入
    let safe_owner = owner_id.replace('"', "");

    // provider → id 映射表（含已存在 + 新建），供回填使用
    let mut provider_to_id: Vec<(String, String)> = Vec::new();

    for (name, emoji, color, provider) in DEFAULT_AGENTS {
        // 安全转义 provider
        let safe_provider = provider.replace('"', "");

        // 按 owner + provider 查询（不过滤 deleted_at，软删也算存在）
        let filter = format!(
            "owner = \"{}\" && provider = \"{}\"",
            safe_owner, safe_provider
        );
        match client.list("agent_profiles", &filter, "id").await {
            Ok(rows) if !rows.is_empty() => {
                // 已存在（含软删）→ 跳过创建，但记录 id 供回填
                if let Some(id) = rows[0]["id"].as_str() {
                    provider_to_id.push(((*provider).to_string(), id.to_string()));
                }
                continue;
            }
            Ok(_) => {
                // 不存在 → 继续创建
            }
            Err(e) => {
                // 查询失败 → 记录日志，跳过此 provider（非致命）
                eprintln!("[keelson] 查询 agent_profiles({provider}) 失败（跳过，非致命）: {e}");
                continue;
            }
        }

        // 创建默认队友
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
            Err(e) => {
                // 创建失败 → 记录日志，继续下一个（非致命，下次启动可自愈）
                eprintln!("[keelson] 预置默认队友 {name} 失败（非致命，下次启动可自愈）: {e}");
            }
        }
    }

    // 回填：现有 agent_provider 非空但 agent_id 空的任务 → 设为对应 provider 的默认队友 id
    // 每次启动都跑，但 agent_id = "" 过滤保证幂等（已回填的不会重复处理）
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
