//! Indexer：把会话切块→批量嵌入→装入 VectorStore；检索结果去重取每会话代表片段。
use super::chunk::{chunk_session, MAX_CHUNKS_PER_SESSION, MAX_CHUNK_CHARS};
use super::embed::{model_id, Embedder};
use super::store::{StoredVec, VectorStore};
use super::{EmbedConfig, RagHit};
use crate::models::Session;

/// 全量构建向量库：分块→嵌入→装 store。分批嵌入以控请求大小。
pub async fn build_store(
    sessions: &[Session],
    embedder: &Embedder,
    cfg: &EmbedConfig,
) -> Result<VectorStore, String> {
    let mut store = VectorStore::new(&model_id(cfg), embedder.dim());
    // 收集全部块
    let mut chunks = Vec::new();
    for s in sessions {
        chunks.extend(chunk_session(s, MAX_CHUNK_CHARS, MAX_CHUNKS_PER_SESSION));
    }
    // 分批嵌入（每批 64）
    const BATCH: usize = 64;
    for batch in chunks.chunks(BATCH) {
        let texts: Vec<String> = batch.iter().map(|c| c.text.clone()).collect();
        let vectors = embedder.embed(&texts).await?;
        // 校验嵌入返回数量与请求一致，避免 zip 静默丢块
        if vectors.len() != batch.len() {
            return Err(format!(
                "嵌入返回数量({})与请求({})不符",
                vectors.len(),
                batch.len()
            ));
        }
        for (chunk, vector) in batch.iter().zip(vectors.into_iter()) {
            store.vecs.push(StoredVec { chunk: chunk.clone(), vector });
        }
    }
    Ok(store)
}

/// 把打分结果转 RagHit：按会话去重，每会话最多 per_session 个代表（结果已按分降序）。
pub fn hits_from(results: Vec<(StoredVec, f32)>, per_session: usize) -> Vec<RagHit> {
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut out = Vec::new();
    for (sv, score) in results {
        let count = seen.entry(sv.chunk.session_id.clone()).or_insert(0);
        if *count >= per_session {
            continue;
        }
        *count += 1;
        out.push(RagHit {
            session_id: sv.chunk.session_id,
            provider: sv.chunk.provider,
            role: sv.chunk.role,
            snippet: sv.chunk.text.chars().take(200).collect(),
            score,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rag::store::StoredVec;
    use crate::rag::Chunk;

    fn sv(session: &str, seq: u32, text: &str) -> StoredVec {
        StoredVec {
            chunk: Chunk { session_id: session.into(), provider: "claude".into(), role: "user".into(), seq, text: text.into() },
            vector: vec![],
        }
    }

    #[test]
    fn hits_dedup_keeps_best_per_session() {
        let results = vec![
            (sv("s1", 0, "aaa"), 0.9f32),
            (sv("s1", 1, "bbb"), 0.8f32), // 同会话较低分应被去掉（per_session=1）
            (sv("s2", 0, "ccc"), 0.7f32),
        ];
        let hits = hits_from(results, 1);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].session_id, "s1");
        assert_eq!(hits[0].snippet, "aaa");
        assert_eq!(hits[1].session_id, "s2");
    }
}
