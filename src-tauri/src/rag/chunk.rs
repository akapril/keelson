//! 分块纯逻辑：把会话消息切成限长文本块，UTF-8 字符边界安全，整体封顶。
use super::Chunk;
use crate::models::Session;

pub const MAX_CHUNK_CHARS: usize = 800;
pub const MAX_CHUNKS_PER_SESSION: usize = 60;

/// 按「字符」切分（非字节），空白裁剪后为空则返回空。
pub fn chunk_text(text: &str, max_chars: usize) -> Vec<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= max_chars {
        return vec![trimmed.to_string()];
    }
    chars
        .chunks(max_chars)
        .map(|c| c.iter().collect::<String>())
        .collect()
}

/// 把一个会话的用户消息切块（v1 先索引 user_messages；封顶 max_chunks 防超长会话爆量）。
pub fn chunk_session(s: &Session, max_chars: usize, max_chunks: usize) -> Vec<Chunk> {
    let mut out: Vec<Chunk> = Vec::new();
    let mut seq: u32 = 0;
    for msg in &s.user_messages {
        for piece in chunk_text(msg, max_chars) {
            if out.len() >= max_chunks {
                return out;
            }
            out.push(Chunk {
                session_id: s.session_id.clone(),
                provider: s.provider.clone(),
                role: "user".into(),
                seq,
                text: piece,
            });
            seq += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Session;
    use chrono::Utc;

    fn session(msgs: Vec<&str>) -> Session {
        Session {
            session_id: "s1".into(),
            provider: "claude".into(),
            project_path: "/p".into(),
            project_name: "p".into(),
            first_prompt: "".into(),
            last_prompt: "".into(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            message_count: msgs.len() as u32,
            user_messages: msgs.into_iter().map(String::from).collect(),
            total_tokens: 0,
        }
    }

    #[test]
    fn short_text_is_single_chunk() {
        assert_eq!(chunk_text("hello", 800), vec!["hello".to_string()]);
    }

    #[test]
    fn long_text_split_by_char_boundary() {
        let parts = chunk_text(&"a".repeat(1000), 400);
        assert_eq!(parts.len(), 3); // 400 + 400 + 200
        assert_eq!(parts[0].chars().count(), 400);
    }

    #[test]
    fn multibyte_not_broken() {
        // 每个中文 3 字节；按「字符」切不应切碎 UTF-8
        let s = "汉".repeat(500);
        let parts = chunk_text(&s, 200);
        assert_eq!(parts.len(), 3);
        // 每块都是合法字符串（未 panic 即证明未切碎）
        assert!(parts.iter().all(|p| !p.is_empty()));
    }

    #[test]
    fn empty_text_yields_no_chunks() {
        assert!(chunk_text("   ", 800).is_empty());
    }

    #[test]
    fn chunk_session_caps_total_chunks() {
        // 100 条各超长的消息，每条切多块，但整体封顶 max_chunks
        let long: Vec<String> = (0..100).map(|_| "y".repeat(2000)).collect();
        let s = session(long.iter().map(|x| x.as_str()).collect());
        let chunks = chunk_session(&s, 800, 10);
        assert!(chunks.len() <= 10);
        assert_eq!(chunks[0].session_id, "s1");
        assert_eq!(chunks[0].seq, 0);
    }
}
