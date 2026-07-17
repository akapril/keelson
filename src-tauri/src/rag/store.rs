//! 向量存储：内存持有全部块向量，暴力余弦 Top-K；bincode 落盘。v1 无向量数据库（YAGNI）。
use super::Chunk;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredVec {
    pub chunk: Chunk,
    pub vector: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorStore {
    pub model_id: String, // 嵌入 provider+model 标识；变更即失效
    pub dim: usize,
    pub vecs: Vec<StoredVec>,
}

/// 余弦相似度；任一向量零范数返回 0。
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..a.len().min(b.len()) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

impl VectorStore {
    pub fn new(model_id: &str, dim: usize) -> Self {
        Self { model_id: model_id.into(), dim, vecs: Vec::new() }
    }

    /// 与全量做余弦，取 Top-K（降序）。
    pub fn search(&self, query: &[f32], k: usize) -> Vec<(StoredVec, f32)> {
        let mut scored: Vec<(StoredVec, f32)> = self
            .vecs
            .iter()
            .map(|v| (v.clone(), cosine(query, &v.vector)))
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(k);
        scored
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let bytes = bincode::serialize(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        std::fs::write(path, bytes)
    }

    /// 加载并校验 model_id + dim；不匹配或损坏返回 None（调用方重建）。
    pub fn load(path: &Path, model_id: &str, dim: usize) -> Option<VectorStore> {
        let bytes = std::fs::read(path).ok()?;
        let store: VectorStore = bincode::deserialize(&bytes).ok()?;
        if store.model_id == model_id && store.dim == dim {
            Some(store)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rag::Chunk;

    fn chunk(id: &str) -> Chunk {
        Chunk { session_id: id.into(), provider: "claude".into(), role: "user".into(), seq: 0, text: id.into() }
    }

    #[test]
    fn cosine_identical_is_one() {
        assert!((cosine(&[1.0, 0.0], &[1.0, 0.0]) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_orthogonal_is_zero() {
        assert!(cosine(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
    }

    #[test]
    fn search_ranks_by_similarity_desc() {
        let mut store = VectorStore::new("m", 2);
        store.vecs.push(StoredVec { chunk: chunk("a"), vector: vec![1.0, 0.0] });
        store.vecs.push(StoredVec { chunk: chunk("b"), vector: vec![0.0, 1.0] });
        store.vecs.push(StoredVec { chunk: chunk("c"), vector: vec![0.9, 0.1] });
        let hits = store.search(&[1.0, 0.0], 2);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].0.chunk.session_id, "a"); // 最相似
        assert_eq!(hits[1].0.chunk.session_id, "c");
    }

    #[test]
    fn save_load_roundtrip() {
        let dir = std::env::temp_dir().join("rework_rag_test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("vec.bin");
        let mut store = VectorStore::new("model-x", 2);
        store.vecs.push(StoredVec { chunk: chunk("a"), vector: vec![1.0, 0.0] });
        store.save(&path).unwrap();
        // 相同 model/dim → 加载成功
        let loaded = VectorStore::load(&path, "model-x", 2).unwrap();
        assert_eq!(loaded.vecs.len(), 1);
        // model 不匹配 → None（视为失效）
        assert!(VectorStore::load(&path, "other", 2).is_none());
    }
}
