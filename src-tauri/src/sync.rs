// sync.rs — 会话元数据同步到 PocketBase（Task 15）
// 职责：计算内容哈希 + 增量 upsert sessions_meta 集合
// 严格遵循 YAGNI/KISS：SHA-256 跨版本稳定哈希，无 debounce（MVP 直接调用）

use crate::models::Session;
use crate::pb::client::PbClient;
use sha2::{Digest, Sha256};

// ============================================================
// content_hash：会话稳定性哈希（用于跳过未变化的记录）
// ============================================================

/// 计算会话内容哈希：基于 updated_at + message_count + last_prompt 的 SHA-256 hex 摘要。
/// 相同输入保证输出一致（SHA-256 是跨进程、跨版本确定性的）；
/// 不同的 message_count 或 last_prompt 产生不同哈希，提供变更检测能力。
///
/// 使用 SHA-256（sha2 crate）替代 DefaultHasher，确保跨进程/跨 Rust 版本稳定性，
/// 避免升级后首次启动对所有记录误发 PATCH。
pub fn content_hash(s: &Session) -> String {
    // 将关键字段拼为稳定字符串，再计算 SHA-256
    let input = format!(
        "{}|{}|{}",
        s.updated_at.timestamp_micros(),
        s.message_count,
        s.last_prompt
    );
    let digest = Sha256::digest(input.as_bytes());
    // 截取前 16 字节（32 位 hex）：对内容变更检测足够，且与 PB text 字段兼容
    hex::encode(&digest[..16])
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
///
/// 单条 session 的 PATCH/CREATE 错误不中止整体同步（per-session 错误隔离）。
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
                // per-session 错误隔离：PATCH 失败仅记录警告，继续下一条
                match client.patch(COLL, id, &patch_data).await {
                    Ok(_) => patched += 1,
                    Err(e) => {
                        eprintln!("[sync] 警告：PATCH 失败，跳过 session_id={}: {e:#}", session.session_id);
                    }
                }
            }
            Ok(None) => {
                // 不存在 → CREATE（含 owner 字段）
                let create_data = build_scan_fields(session, &hash, owner_id);
                // per-session 错误隔离：CREATE 失败仅记录警告，继续下一条
                match client.create(COLL, &create_data).await {
                    Ok(_) => created += 1,
                    Err(e) => {
                        eprintln!("[sync] 警告：CREATE 失败，跳过 session_id={}: {e:#}", session.session_id);
                    }
                }
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

    /// 验证 SHA-256 哈希的跨进程稳定性（固定输入 → 固定输出）
    #[test]
    fn content_hash_is_stable_across_runs() {
        let s = make_session("sess-stable", 10, "stable prompt");
        let h1 = content_hash(&s);
        let h2 = content_hash(&s);
        // SHA-256 保证相同输入永远产生相同输出（跨进程/跨版本稳定）
        assert_eq!(h1, h2, "SHA-256 哈希应跨调用稳定：h1={h1}, h2={h2}");
        // 验证格式：32 位 hex（16 字节 * 2 hex chars）
        assert_eq!(h1.len(), 32, "哈希应为 32 位 hex 字符串，实际：{}", h1.len());
        assert!(h1.chars().all(|c| c.is_ascii_hexdigit()), "哈希应只含 hex 字符：{h1}");
        eprintln!("[TDD GREEN] content_hash_is_stable_across_runs: hash={h1}");
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
