// sync.rs — 会话元数据同步到 PocketBase（Task 15）
// 职责：计算内容哈希 + 增量 upsert sessions_meta 集合
// 严格遵循 YAGNI/KISS：DefaultHasher（无新依赖），无 debounce（MVP 直接调用）

use crate::models::Session;
use crate::pb::client::PbClient;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

// ============================================================
// content_hash：会话稳定性哈希（用于跳过未变化的记录）
// ============================================================

/// 计算会话内容哈希：基于 updated_at + message_count + last_prompt 的稳定字符串哈希。
/// 相同输入保证输出一致（DefaultHasher 在同进程内确定性）；
/// 不同的 message_count 或 last_prompt 产生不同哈希，提供变更检测能力。
///
/// 注意：DefaultHasher 在跨进程/版本间不保证稳定，但对本应用来说足够：
/// 每次启动重新计算，PB 端存储的哈希与本次计算比较，跨进程差异最多导致一次多余 PATCH，
/// 而不会导致数据错误。符合 YAGNI 原则（不引入 sha2 依赖）。
pub fn content_hash(s: &Session) -> String {
    // 将关键字段拼为稳定字符串，再散列
    let input = format!(
        "{}|{}|{}",
        s.updated_at.timestamp_micros(),
        s.message_count,
        s.last_prompt
    );
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

// ============================================================
// sync_to_pb：增量 upsert sessions_meta
// ============================================================

/// sessions_meta 集合名（与 Task 5 迁移脚本保持一致）
const COLL: &str = "sessions_meta";

/// 将扫描到的 sessions 增量同步到 PocketBase sessions_meta 集合。
///
/// 策略：
/// - 对每条 session：用 filter 查找已有记录（owner + session_id 联合键）
/// - 若已存在且 content_hash 未变化 → 跳过（幂等）
/// - 若已存在且 hash 变化 → PATCH（只写 Rust 负责的扫描字段）
/// - 若不存在 → CREATE
///
/// **严格禁止写 favorite / hidden / custom_name**（用户专属字段，由前端管理）。
pub async fn sync_to_pb(
    client: &PbClient,
    owner_id: &str,
    sessions: &[Session],
) -> anyhow::Result<()> {
    let mut created = 0usize;
    let mut patched = 0usize;
    let mut skipped = 0usize;

    for session in sessions {
        let hash = content_hash(session);

        // 构建 filter 查询（owner + session_id 联合唯一）
        // 使用单引号包裹值（PocketBase filter 语法）
        let filter = format!(
            "owner='{}' && session_id='{}'",
            owner_id, session.session_id
        );

        // 查询已有记录
        match client.find_one(COLL, &filter).await {
            Ok(Some(existing)) => {
                // 比较 content_hash：相同则跳过，不同则 PATCH
                let remote_hash = existing["content_hash"].as_str().unwrap_or("");
                if remote_hash == hash {
                    skipped += 1;
                    continue;
                }

                // PATCH：只更新扫描字段，绝不写 favorite/hidden/custom_name
                let id = existing["id"].as_str().unwrap_or_default();
                if id.is_empty() {
                    eprintln!("[sync] 警告：记录缺少 id，跳过 PATCH session_id={}", session.session_id);
                    continue;
                }

                let patch_data = build_scan_fields(session, &hash, owner_id);
                client.patch(COLL, id, &patch_data).await.map_err(|e| {
                    anyhow::anyhow!("PATCH session_id={} 失败: {e:#}", session.session_id)
                })?;
                patched += 1;
            }
            Ok(None) => {
                // 不存在 → CREATE（含 owner 字段）
                let create_data = build_scan_fields(session, &hash, owner_id);
                client.create(COLL, &create_data).await.map_err(|e| {
                    anyhow::anyhow!("CREATE session_id={} 失败: {e:#}", session.session_id)
                })?;
                created += 1;
            }
            Err(e) => {
                // find_one 失败：记录警告后继续，单条失败不中止整体同步
                eprintln!("[sync] find_one 失败 session_id={}: {e:#}", session.session_id);
            }
        }
    }

    eprintln!(
        "[sync] sessions_meta 同步完成：{} 新建，{} 更新，{} 跳过（共 {} 条）",
        created,
        patched,
        skipped,
        sessions.len()
    );

    Ok(())
}

/// 构建只包含 Rust 负责的扫描字段的 JSON 对象。
/// 严格排除 favorite / hidden / custom_name（用户专属，前端写）。
fn build_scan_fields(session: &Session, hash: &str, owner_id: &str) -> serde_json::Value {
    serde_json::json!({
        // 关系字段
        "owner":         owner_id,
        // 业务字段（扫描数据）
        "session_id":    session.session_id,
        "provider":      session.provider,
        "project_path":  session.project_path,
        "project_name":  session.project_name,
        "last_prompt":   session.last_prompt,
        "message_count": session.message_count,
        "total_tokens":  session.total_tokens,
        "content_hash":  hash,
        // orphaned 默认 false（Rust 扫描到的会话均为活跃状态）
        "orphaned":      false,
    })
    // ⚠️ 注意：此处不包含 favorite / hidden / custom_name
}

// ============================================================
// 单元测试（TDD — content_hash 纯函数）
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    /// 构造测试用 Session（使用确定性时间戳避免测试抖动）
    fn make_session(id: &str, message_count: u32, last_prompt: &str) -> Session {
        Session {
            session_id: id.to_string(),
            provider: "claude".to_string(),
            project_path: "/tmp/test".to_string(),
            project_name: "test".to_string(),
            first_prompt: "first".to_string(),
            last_prompt: last_prompt.to_string(),
            // 固定时间：确保哈希结果确定性
            created_at: chrono::DateTime::from_timestamp(1_700_000_000, 0)
                .unwrap_or_else(Utc::now),
            updated_at: chrono::DateTime::from_timestamp(1_700_000_000, 0)
                .unwrap_or_else(Utc::now),
            message_count,
            user_messages: vec![last_prompt.to_string()],
            total_tokens: 100,
        }
    }

    /// TDD Step 1 (RED → GREEN)：
    /// 验证 content_hash 对 message_count 不同的两条 session 产生不同哈希，
    /// 对完全相同的两条 session 产生相同哈希。
    #[test]
    fn content_hash_changes_with_message_count() {
        let s1 = make_session("sess-A", 5, "hello world");
        let s2 = make_session("sess-A", 6, "hello world"); // 只改 message_count

        let h1 = content_hash(&s1);
        let h2 = content_hash(&s2);

        // 不同 message_count → 不同哈希
        assert_ne!(
            h1, h2,
            "message_count 不同时哈希应不同：h1={h1}, h2={h2}"
        );

        // 相同 session 重复计算 → 相同哈希（幂等性）
        let h1_again = content_hash(&s1);
        assert_eq!(
            h1, h1_again,
            "相同 session 重复计算哈希应相同：h1={h1}, h1_again={h1_again}"
        );

        eprintln!(
            "[TDD GREEN] content_hash_changes_with_message_count: h(mc=5)={h1}, h(mc=6)={h2}"
        );
    }

    /// 额外验证：last_prompt 变化也产生不同哈希
    #[test]
    fn content_hash_changes_with_last_prompt() {
        let s1 = make_session("sess-B", 3, "prompt A");
        let s2 = make_session("sess-B", 3, "prompt B"); // 只改 last_prompt

        let h1 = content_hash(&s1);
        let h2 = content_hash(&s2);

        assert_ne!(
            h1, h2,
            "last_prompt 不同时哈希应不同：h1={h1}, h2={h2}"
        );

        eprintln!(
            "[TDD GREEN] content_hash_changes_with_last_prompt: h(A)={h1}, h(B)={h2}"
        );
    }

    /// 验证 build_scan_fields 不包含用户专属字段
    #[test]
    fn build_scan_fields_excludes_user_fields() {
        let s = make_session("sess-C", 2, "test prompt");
        let hash = content_hash(&s);
        let data = build_scan_fields(&s, &hash, "owner123");

        // 必须包含的扫描字段
        assert!(data.get("owner").is_some(), "应包含 owner");
        assert!(data.get("session_id").is_some(), "应包含 session_id");
        assert!(data.get("provider").is_some(), "应包含 provider");
        assert!(data.get("content_hash").is_some(), "应包含 content_hash");
        assert!(data.get("orphaned").is_some(), "应包含 orphaned");

        // 严禁包含用户专属字段
        assert!(data.get("favorite").is_none(), "不应包含 favorite");
        assert!(data.get("hidden").is_none(), "不应包含 hidden");
        assert!(data.get("custom_name").is_none(), "不应包含 custom_name");

        eprintln!("[TDD GREEN] build_scan_fields_excludes_user_fields: fields={:?}", data.as_object().map(|o| o.keys().collect::<Vec<_>>()));
    }
}
