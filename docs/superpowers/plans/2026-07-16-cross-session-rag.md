# ② 跨会话语义检索 RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把用户本地全部 Claude Code / Codex 会话历史变成可语义搜索的知识库：「上次我怎么解决 X」→ 语义召回相关会话片段 +（可选）AI 综合答案 + 跳转来源会话。默认全程本机。

**Architecture:** 新增 Rust `rag` 模块，三部分单一职责：分块（纯逻辑）、向量存储（内存暴力余弦 + bincode 落盘）、嵌入（enum dispatch：Api / Local(fastembed，可选 feature) / Mock）。两个命令：`rag_build_index`（分块→嵌入→落盘，emit 进度）与 `rag_search`（嵌入 query→加载 store→余弦 Top-K）。嵌入配置由前端按调用传入（仿 AiConfig）。前端会话中枢加「问」模式：调 `rag_search`，永远先渲染召回卡片，配了 AI 再综合答案带 `[n]` 引用；索引未就绪时回退现有 Tantivy `sessions_search`。

**Tech Stack:** Rust（serde, bincode 新增, tokio, reqwest 已在），可选 `fastembed`（feature 门控）；React 19 + TS，zustand。

参考设计稿：`docs/superpowers/specs/2026-07-16-rework-session-rag-design.md`。

## Global Constraints

- 注释与日志默认中文。
- 复用现有：`AppState.sessions`（`Vec<Session>`）、`models::Session{session_id,provider,user_messages,total_tokens,...}`、`TimelineMessage{role,content,timestamp}`、`sessions_timeline` 命令、前端 `sessions_search` 回退。
- 向量文件落 `app_data_dir`（同 `scan_cache.json` 所在目录，见 lib.rs `data_dir`）。
- **EmbeddingProvider 用 enum dispatch**（非 trait object），避免引入 `async-trait`；等价于设计稿抽象。
- **fastembed 为可选 feature**（`--features local-embed`）：默认构建不链接 ONNX，保证 CI/默认体积；`ApiEmbedder`+`MockEmbedder` 为默认路径。
- 向量文件头含 `provider+model+dim`；不匹配 → 视为失效需重建。
- `rag_search` 任何失败/未就绪 → 返回空 `Vec<RagHit>`，前端据此回退 Tantivy。
- 新增 crate 仅：`bincode = "1"`（默认）、`fastembed`（可选 feature）。

---

### Task 1: 分块纯逻辑

**Files:**
- Create: `src-tauri/src/rag/mod.rs`（先只 `pub mod chunk;` + 公共类型）
- Create: `src-tauri/src/rag/chunk.rs`
- Modify: `src-tauri/src/lib.rs`（顶部 `mod rag;`）

**Interfaces:**
- Consumes: `crate::models::Session`。
- Produces:
  - `pub struct Chunk { pub session_id: String, pub provider: String, pub role: String, pub seq: u32, pub text: String }`（在 `rag/mod.rs`）
  - `pub fn chunk_text(text: &str, max_chars: usize) -> Vec<String>`（按字符边界切，多字节安全）
  - `pub fn chunk_session(s: &Session, max_chars: usize, max_chunks: usize) -> Vec<Chunk>`
  - 常量 `pub const MAX_CHUNK_CHARS: usize = 800;` `pub const MAX_CHUNKS_PER_SESSION: usize = 60;`

- [ ] **Step 1: 写失败测试**

`src-tauri/src/rag/chunk.rs`（末尾）：

```rust
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
        let msgs: Vec<&str> = vec!["x".repeat(1).leak() as &str; 0]; // placeholder
        let _ = msgs;
        let long: Vec<String> = (0..100).map(|_| "y".repeat(2000)).collect();
        let s = session(long.iter().map(|x| x.as_str()).collect());
        let chunks = chunk_session(&s, 800, 10);
        assert!(chunks.len() <= 10);
        assert_eq!(chunks[0].session_id, "s1");
        assert_eq!(chunks[0].seq, 0);
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd src-tauri && cargo test rag::chunk`
Expected: 编译失败（未定义）。

- [ ] **Step 3: 实现**

`src-tauri/src/rag/mod.rs`：

```rust
//! RAG：把本地会话历史变成可语义检索的知识库。
//! 分块（chunk）+ 向量存储（store）+ 嵌入（embed），命令层在 commands::rag。
pub mod chunk;

use serde::{Deserialize, Serialize};

/// 一个可嵌入的文本块。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub session_id: String,
    pub provider: String,
    pub role: String, // "user" / "assistant"
    pub seq: u32,     // 会话内块序号
    pub text: String,
}
```

`src-tauri/src/rag/chunk.rs`（tests 之前）：

```rust
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
```

`src-tauri/src/lib.rs` 顶部模块声明区加：

```rust
mod rag; // 跨会话语义检索
```

- [ ] **Step 4: 运行确认通过**

Run: `cd src-tauri && cargo test rag::chunk`
Expected: 5 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/rag/mod.rs src-tauri/src/rag/chunk.rs src-tauri/src/lib.rs
git commit -m "feat(rag): 会话分块纯逻辑（字符边界安全、整体封顶）+ 单测"
```

---

### Task 2: 向量存储（余弦 Top-K + bincode 落盘）

**Files:**
- Create: `src-tauri/src/rag/store.rs`
- Modify: `src-tauri/src/rag/mod.rs`（`pub mod store;`）
- Modify: `src-tauri/Cargo.toml`（`bincode = "1"`）

**Interfaces:**
- Consumes: `Chunk`。
- Produces:
  - `pub struct StoredVec { pub chunk: Chunk, pub vector: Vec<f32> }`
  - `pub struct VectorStore { pub model_id: String, pub dim: usize, pub vecs: Vec<StoredVec> }`
  - `pub fn cosine(a: &[f32], b: &[f32]) -> f32`
  - `impl VectorStore { fn new(model_id, dim); fn search(&self, query: &[f32], k: usize) -> Vec<(StoredVec, f32)>; fn save(&self, path); fn load(path, model_id, dim) -> Option<VectorStore> }`

- [ ] **Step 1: 加依赖**

`src-tauri/Cargo.toml` `[dependencies]` 加：

```toml
bincode = "1" # RAG 向量文件序列化
```

- [ ] **Step 2: 写失败测试**

`src-tauri/src/rag/store.rs`（末尾）：

```rust
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
```

- [ ] **Step 3: 运行确认失败**

Run: `cd src-tauri && cargo test rag::store`
Expected: 编译失败。

- [ ] **Step 4: 实现**

`src-tauri/src/rag/store.rs`（tests 之前）：

```rust
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
```

`src-tauri/src/rag/mod.rs` 加 `pub mod store;`。

- [ ] **Step 5: 运行确认通过**

Run: `cd src-tauri && cargo test rag::store`
Expected: 4 个测试 PASS。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/rag/store.rs src-tauri/src/rag/mod.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(rag): 向量存储（余弦 Top-K + bincode 落盘 + 失效校验）+ 单测"
```

---

### Task 3: 嵌入 provider（enum dispatch：Api / Mock）

**Files:**
- Create: `src-tauri/src/rag/embed.rs`
- Modify: `src-tauri/src/rag/mod.rs`（`pub mod embed;` + `EmbedConfig` 类型）

**Interfaces:**
- Produces:
  - `pub struct EmbedConfig { pub provider: String, pub base_url: String, pub api_key: String, pub model: String }`（在 mod.rs）
  - `pub fn model_id(cfg: &EmbedConfig) -> String` → `"{provider}:{model}"`
  - `pub enum Embedder { Api(ApiEmbedder), Mock(MockEmbedder) }`（Local 变体在 Task 7 加）
  - `impl Embedder { pub async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String>; pub fn dim(&self) -> usize }`
  - `pub fn build_embedder(cfg: &EmbedConfig) -> Result<Embedder, String>`

- [ ] **Step 1: 写失败测试**（Mock 的确定性与维度）

`src-tauri/src/rag/embed.rs`（末尾）：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_is_deterministic_and_dim_matches() {
        let e = Embedder::Mock(MockEmbedder { dim: 8 });
        let a = e.embed(&["hello".to_string()]).await.unwrap();
        let b = e.embed(&["hello".to_string()]).await.unwrap();
        assert_eq!(a[0].len(), 8);
        assert_eq!(a, b); // 同输入同输出
        assert_eq!(e.dim(), 8);
    }

    #[tokio::test]
    async fn mock_different_text_different_vector() {
        let e = Embedder::Mock(MockEmbedder { dim: 8 });
        let a = e.embed(&["hello".to_string()]).await.unwrap();
        let b = e.embed(&["world".to_string()]).await.unwrap();
        assert_ne!(a[0], b[0]);
    }

    #[test]
    fn model_id_combines_provider_and_model() {
        let cfg = EmbedConfig {
            provider: "api".into(), base_url: "".into(), api_key: "".into(),
            model: "text-embedding-3-small".into(),
        };
        assert_eq!(model_id(&cfg), "api:text-embedding-3-small");
    }

    #[test]
    fn build_embedder_selects_mock() {
        let cfg = EmbedConfig {
            provider: "mock".into(), base_url: "".into(), api_key: "".into(), model: "m".into(),
        };
        assert!(matches!(build_embedder(&cfg), Ok(Embedder::Mock(_))));
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd src-tauri && cargo test rag::embed`
Expected: 编译失败。

- [ ] **Step 3: 实现**

`src-tauri/src/rag/mod.rs` 追加：

```rust
pub mod store;
pub mod embed;

use serde::Deserialize;

/// 嵌入配置（前端按调用传入，仿 AiConfig）。
#[derive(Debug, Clone, Deserialize)]
pub struct EmbedConfig {
    pub provider: String, // "api" | "local" | "mock"
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}
```

（注意：`pub mod chunk;` 已在 Task1，勿重复；把 `store`/`embed` 与已有声明合并整理。）

`src-tauri/src/rag/embed.rs`（tests 之前）：

```rust
//! 嵌入 provider：enum dispatch（避免 async-trait）。Api=OpenAI 兼容 embeddings；Mock=确定性哈希向量（测试/离线兜底）。
use super::EmbedConfig;

/// provider+model 组合标识，用于向量文件失效判断。
pub fn model_id(cfg: &EmbedConfig) -> String {
    format!("{}:{}", cfg.provider, cfg.model)
}

/// 云端 OpenAI 兼容 embeddings。
pub struct ApiEmbedder {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub dim: usize,
}

/// 确定性伪向量：无外部依赖，用于测试与「未配置嵌入」兜底。
pub struct MockEmbedder {
    pub dim: usize,
}

pub enum Embedder {
    Api(ApiEmbedder),
    Mock(MockEmbedder),
}

impl MockEmbedder {
    /// 对每个字符做简单散列，铺进 dim 维并归一化 —— 同文本恒定、异文本相异。
    fn embed_one(&self, text: &str) -> Vec<f32> {
        let mut v = vec![0.0f32; self.dim];
        for (i, b) in text.bytes().enumerate() {
            v[i % self.dim] += (b as f32) * ((i as f32 % 7.0) + 1.0);
        }
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for x in &mut v {
                *x /= norm;
            }
        }
        v
    }
}

impl Embedder {
    pub fn dim(&self) -> usize {
        match self {
            Embedder::Api(e) => e.dim,
            Embedder::Mock(e) => e.dim,
        }
    }

    pub async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        match self {
            Embedder::Mock(e) => Ok(texts.iter().map(|t| e.embed_one(t)).collect()),
            Embedder::Api(e) => {
                let root = if e.base_url.trim().is_empty() {
                    "https://api.openai.com/v1".to_string()
                } else {
                    e.base_url.trim_end_matches('/').to_string()
                };
                let client = reqwest::Client::new();
                let resp = client
                    .post(format!("{root}/embeddings"))
                    .header("authorization", format!("Bearer {}", e.api_key))
                    .json(&serde_json::json!({ "model": e.model, "input": texts }))
                    .send()
                    .await
                    .map_err(|err| format!("嵌入请求失败：{err}"))?;
                let v: serde_json::Value = resp
                    .json()
                    .await
                    .map_err(|err| format!("嵌入响应解析失败：{err}"))?;
                let data = v["data"]
                    .as_array()
                    .ok_or("嵌入响应无 data 数组")?;
                let mut out = Vec::with_capacity(data.len());
                for item in data {
                    let arr = item["embedding"]
                        .as_array()
                        .ok_or("嵌入项无 embedding")?;
                    out.push(arr.iter().map(|x| x.as_f64().unwrap_or(0.0) as f32).collect());
                }
                Ok(out)
            }
        }
    }
}

/// 依配置构建 Embedder。未知 provider 回退 Mock（保证可用）。
pub fn build_embedder(cfg: &EmbedConfig) -> Result<Embedder, String> {
    match cfg.provider.as_str() {
        "api" => Ok(Embedder::Api(ApiEmbedder {
            base_url: cfg.base_url.clone(),
            api_key: cfg.api_key.clone(),
            model: cfg.model.clone(),
            // OpenAI text-embedding-3-small = 1536；可由 model 名推断，未知给 1536
            dim: infer_dim(&cfg.model),
        })),
        "mock" => Ok(Embedder::Mock(MockEmbedder { dim: 384 })),
        // "local" 在 local-embed feature 中补（Task 7）
        other => Err(format!("暂不支持的嵌入 provider：{other}")),
    }
}

fn infer_dim(model: &str) -> usize {
    match model {
        "text-embedding-3-large" => 3072,
        "text-embedding-3-small" => 1536,
        _ => 1536,
    }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd src-tauri && cargo test rag::embed`
Expected: 4 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/rag/embed.rs src-tauri/src/rag/mod.rs
git commit -m "feat(rag): 嵌入 provider（Api/Mock enum dispatch）+ 单测"
```

---

### Task 4: Indexer（会话→块→向量→落盘）

**Files:**
- Create: `src-tauri/src/rag/indexer.rs`
- Modify: `src-tauri/src/rag/mod.rs`（`pub mod indexer;` + `RagHit` 类型）

**Interfaces:**
- Consumes: `Session`、`Embedder`、`VectorStore`、`chunk_session`。
- Produces:
  - `pub struct RagHit { pub session_id, pub provider, pub role, pub snippet: String, pub score: f32 }`（Serialize）
  - `pub async fn build_store(sessions, embedder, cfg) -> Result<VectorStore, String>`
  - `pub fn hits_from(results: Vec<(StoredVec, f32)>, per_session: usize) -> Vec<RagHit>`（跨会话去重取代表）

- [ ] **Step 1: 写失败测试**（去重逻辑纯函数）

`src-tauri/src/rag/indexer.rs`（末尾）：

```rust
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd src-tauri && cargo test rag::indexer`
Expected: 编译失败。

- [ ] **Step 3: 实现**

`src-tauri/src/rag/mod.rs` 追加：

```rust
pub mod indexer;

use serde::Serialize;

/// 检索命中片段（回传前端）。
#[derive(Debug, Clone, Serialize)]
pub struct RagHit {
    pub session_id: String,
    pub provider: String,
    pub role: String,
    pub snippet: String,
    pub score: f32,
}
```

`src-tauri/src/rag/indexer.rs`（tests 之前）：

```rust
//! Indexer：把会话切块→批量嵌入→装入 VectorStore；检索结果去重取每会话代表片段。
use super::chunk::{chunk_session, MAX_CHUNKS_PER_SESSION, MAX_CHUNK_CHARS};
use super::embed::{model_id, Embedder};
use super::store::{StoredVec, VectorStore};
use super::{EmbedConfig, RagHit};
use crate::models::Session;
use std::collections::HashSet;

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
    let mut _dedup: HashSet<String> = HashSet::new();
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
```

`src-tauri/src/rag/mod.rs` 加 `pub mod indexer;`（若未加）。

- [ ] **Step 4: 运行确认通过**

Run: `cd src-tauri && cargo test rag::indexer`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/rag/indexer.rs src-tauri/src/rag/mod.rs
git commit -m "feat(rag): Indexer（分批嵌入构库 + 每会话去重取代表）+ 单测"
```

---

### Task 5: 命令层 rag_build_index / rag_search + 注册

**Files:**
- Create: `src-tauri/src/commands/rag.rs`
- Modify: `src-tauri/src/commands/mod.rs`（`pub mod rag;`）
- Modify: `src-tauri/src/lib.rs`（generate_handler! 加两命令；向量文件路径）

**Interfaces:**
- Consumes: `AppState.sessions`、`rag::{EmbedConfig, build_embedder, build_store, hits_from, RagHit}`、`VectorStore`。
- Produces（Tauri 命令）:
  - `rag_build_index(config: EmbedConfig, state) -> Result<usize, String>`（返回索引块数，emit `"rag-index-progress"`）
  - `rag_search(config: EmbedConfig, query: String, limit: u32, state) -> Result<Vec<RagHit>, String>`

- [ ] **Step 1: 实现命令**

`src-tauri/src/commands/rag.rs`：

```rust
//! RAG 命令层：构建向量库 / 语义检索。嵌入配置由前端传入；向量文件落 app_data_dir。
use crate::rag::embed::{build_embedder, model_id};
use crate::rag::indexer::{build_store, hits_from};
use crate::rag::store::VectorStore;
use crate::rag::{EmbedConfig, RagHit};
use crate::AppState;
use tauri::{AppHandle, Emitter, Manager, State};

/// 向量文件路径：app_data_dir/rag_vectors.bin。
fn vec_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("rag_vectors.bin"))
}

/// 全量重建向量库；返回索引到的块数。
#[tauri::command]
pub async fn rag_build_index(
    app: AppHandle,
    config: EmbedConfig,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let sessions = state.sessions.lock().clone();
    let embedder = build_embedder(&config)?;
    let _ = app.emit("rag-index-progress", sessions.len());
    let store = build_store(&sessions, &embedder, &config).await?;
    let path = vec_path(&app)?;
    store.save(&path).map_err(|e| e.to_string())?;
    let _ = app.emit("rag-index-progress", 0); // 0 表示完成
    Ok(store.vecs.len())
}

/// 语义检索：加载向量库（校验 model/dim）→ 嵌入 query → 余弦 Top-K → 去重。
/// 任何未就绪/失败均返回空，前端据此回退关键词检索。
#[tauri::command]
pub async fn rag_search(
    app: AppHandle,
    config: EmbedConfig,
    query: String,
    limit: u32,
    _state: State<'_, AppState>,
) -> Result<Vec<RagHit>, String> {
    let embedder = build_embedder(&config)?;
    let path = match vec_path(&app) {
        Ok(p) => p,
        Err(_) => return Ok(vec![]),
    };
    let store = match VectorStore::load(&path, &model_id(&config), embedder.dim()) {
        Some(s) => s,
        None => return Ok(vec![]), // 未建/失效 → 空，前端回退
    };
    let qv = match embedder.embed(&[query]).await {
        Ok(mut v) if !v.is_empty() => v.remove(0),
        _ => return Ok(vec![]),
    };
    // 取较大候选后按会话去重成 limit 条
    let raw = store.search(&qv, (limit as usize) * 3);
    Ok(hits_from(raw, 1).into_iter().take(limit as usize).collect())
}
```

`src-tauri/src/commands/mod.rs` 加 `pub mod rag;`。

- [ ] **Step 2: 注册命令**

`src-tauri/src/lib.rs` `generate_handler!` 列表（AI 命令附近）加：

```rust
    commands::rag::rag_build_index,
    commands::rag::rag_search,
```

- [ ] **Step 3: 编译校验**

Run: `cd src-tauri && cargo build`
Expected: 通过。若 `Emitter`/`Manager` 未导入报错，按 lib.rs 现有 `use tauri::...` 补齐。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/commands/rag.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(rag): rag_build_index / rag_search 命令 + 注册"
```

---

### Task 6: 前端「问」模式（召回卡片 + 可选 AI 综合 + 回退）

**Files:**
- Create: `src/types/rag.ts`
- Modify: `src/lib/tauri/ipc.ts`（加 `ragBuildIndex`/`ragSearch`）
- Create: `src/features/sessions/AskPane.tsx`
- Modify: `src/features/sessions/SessionListView.tsx`（搜索/问 切换）

**Interfaces:**
- Consumes: `ipc`、`useSettingsStore.aiConfig`、`runAgent`/`ipc.aiChat`、`sessions_search` 回退。
- Produces:
  - `interface RagHit { session_id, provider, role, snippet, content?: string, score }`
  - `interface EmbedConfig { provider, base_url, api_key, model }`
  - `ipc.ragSearch(config, query, limit)`、`ipc.ragBuildIndex(config)`

- [ ] **Step 1: 类型**

`src/types/rag.ts`：

```typescript
// RAG 相关类型（对应 Rust rag::{EmbedConfig, RagHit}）。
export interface EmbedConfig {
  provider: string; // "api" | "local" | "mock"
  base_url: string;
  api_key: string;
  model: string;
}

export interface RagHit {
  session_id: string;
  provider: string;
  role: string;
  snippet: string;
  score: number;
}

export const DEFAULT_EMBED_CONFIG: EmbedConfig = {
  provider: "mock",
  base_url: "",
  api_key: "",
  model: "text-embedding-3-small",
};
```

- [ ] **Step 2: ipc 封装**

`src/lib/tauri/ipc.ts` 的 `ipc` 对象内追加（仿现有 `searchSessions`）：

```typescript
  ragSearch: (config: EmbedConfig, query: string, limit: number) =>
    invoke<RagHit[]>("rag_search", { config, query, limit }),
  ragBuildIndex: (config: EmbedConfig) =>
    invoke<number>("rag_build_index", { config }),
```

并在文件顶部 import：

```typescript
import type { EmbedConfig, RagHit } from "@/types/rag";
```

- [ ] **Step 3: AskPane 组件**

`src/features/sessions/AskPane.tsx`：

```tsx
// 会话中枢「问」模式：语义召回历史会话片段（永远先给列表），配了 AI 再综合答案带 [n] 引用。
// 召回为空（索引未建/失效）时回退关键词检索（sessions_search）。
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ipc } from "@/lib/tauri/ipc";
import { useSettingsStore } from "@/store/settings";
import { DEFAULT_EMBED_CONFIG } from "@/types/rag";
import type { RagHit } from "@/types/rag";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// 嵌入配置：MVP 复用默认（mock）；后续设置页可覆盖（Task 8）。
function embedConfig() {
  try {
    const raw = localStorage.getItem("rework-embed-config");
    return raw ? { ...DEFAULT_EMBED_CONFIG, ...JSON.parse(raw) } : DEFAULT_EMBED_CONFIG;
  } catch {
    return DEFAULT_EMBED_CONFIG;
  }
}

export function AskPane() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<RagHit[]>([]);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [fellBack, setFellBack] = useState(false);

  const ask = async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setAnswer("");
    setFellBack(false);
    try {
      let list = await ipc.ragSearch(embedConfig(), q, 8);
      // 语义召回为空 → 回退关键词检索
      if (list.length === 0) {
        const kw = await ipc.searchSessions(q);
        list = kw.map((h) => ({
          session_id: h.session_id,
          provider: h.provider,
          role: "user",
          snippet: h.snippet,
          score: h.score,
        }));
        setFellBack(true);
      }
      setHits(list);

      // 配了 AI → 用召回片段综合答案（带引用编号）
      const ai = useSettingsStore.getState().aiConfig;
      const isCli = ai.provider === "claude-cli" || ai.provider === "codex-cli";
      if (list.length > 0 && (ai.api_key || isCli)) {
        const ctx = list
          .map((h, i) => `[${i + 1}] (${h.provider}) ${h.snippet}`)
          .join("\n");
        const reply = await ipc.aiChat(ai, [
          { role: "system", content: "根据下列历史会话片段回答用户问题，用简洁中文，引用时标注 [编号]。" },
          { role: "user", content: `片段：\n${ctx}\n\n问题：${q}` },
        ]);
        setAnswer(reply);
      }
    } catch (e) {
      setAnswer(`检索失败：${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-1">
      <div className="flex items-end gap-2">
        <Textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
          placeholder="问历史会话，如「上次我怎么修的 PB 400 错误」"
          className="min-h-12 flex-1"
        />
        <Button onClick={() => void ask()} disabled={loading || !query.trim()}>
          {loading ? "检索中…" : "问"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {answer && (
          <div className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">{answer}</div>
        )}
        {fellBack && hits.length > 0 && (
          <p className="text-xs text-muted-foreground">（语义索引未就绪，已回退关键词检索）</p>
        )}
        {hits.map((h, i) => (
          <button
            key={`${h.session_id}-${i}`}
            type="button"
            onClick={() => navigate(`/sessions?session=${encodeURIComponent(h.session_id)}`)}
            className="block w-full rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5">[{i + 1}]</span>
              <span>{h.provider}</span>
              <span>· 相似度 {h.score.toFixed(2)}</span>
            </div>
            <p className="line-clamp-3 text-sm">{h.snippet}</p>
          </button>
        ))}
        {!loading && hits.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">输入问题，检索你的历史会话</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: SessionListView 加「搜索 / 问」切换**

`src/features/sessions/SessionListView.tsx`：在搜索框区域上方加一个模式切换。顶部 import `AskPane`：

```tsx
import { AskPane } from "./AskPane";
```

在组件内加状态与切换 UI（搜索框 L51-61 之前）：

```tsx
  const [mode, setMode] = useState<"search" | "ask">("search");
```

```tsx
      <div className="mb-2 flex gap-1">
        <button
          type="button"
          onClick={() => setMode("search")}
          className={`rounded-lg px-2.5 py-1 text-xs ${mode === "search" ? "bg-accent" : "text-muted-foreground"}`}
        >
          搜索
        </button>
        <button
          type="button"
          onClick={() => setMode("ask")}
          className={`rounded-lg px-2.5 py-1 text-xs ${mode === "ask" ? "bg-accent" : "text-muted-foreground"}`}
        >
          问历史
        </button>
      </div>
      {mode === "ask" ? (
        <AskPane />
      ) : (
        <>
          {/* 原有搜索框 + 列表 JSX 包进此 Fragment */}
        </>
      )}
```

> 把现有搜索框与列表 JSX 整体移入 `mode === "search"` 分支的 Fragment 内。若结构复杂，最小改动：仅在原 JSX 外层包 `{mode === "search" && ( ... )}` 并在其前渲染 `{mode === "ask" && <AskPane />}`。

- [ ] **Step 5: 类型/构建校验**

Run: `npx tsc --noEmit && npm run build`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add src/types/rag.ts src/lib/tauri/ipc.ts src/features/sessions/AskPane.tsx src/features/sessions/SessionListView.tsx
git commit -m "feat(rag): 会话中枢「问」模式（召回卡片+可选AI综合+关键词回退）"
```

---

### Task 7: 本地嵌入 LocalEmbedder（fastembed，可选 feature）

**Files:**
- Modify: `src-tauri/Cargo.toml`（`[features]` + 可选 `fastembed`）
- Modify: `src-tauri/src/rag/embed.rs`（feature 门控的 Local 变体）

**Interfaces:**
- Produces: `Embedder::Local(LocalEmbedder)`（仅 `local-embed` feature）；`build_embedder` 对 `"local"` 分支在该 feature 下返回 Local，否则报错提示未启用。

- [ ] **Step 1: 加可选依赖与 feature**

`src-tauri/Cargo.toml`：

```toml
[dependencies]
fastembed = { version = "4", optional = true } # 本地嵌入（ONNX），仅 local-embed feature

[features]
local-embed = ["dep:fastembed"]
```

- [ ] **Step 2: feature 门控实现**

`src-tauri/src/rag/embed.rs` 加（enum 增变体需 feature cfg）：

```rust
#[cfg(feature = "local-embed")]
pub struct LocalEmbedder {
    model: std::sync::Arc<parking_lot::Mutex<fastembed::TextEmbedding>>,
    pub dim: usize,
}

// 在 enum Embedder 增加变体：
//   #[cfg(feature = "local-embed")] Local(LocalEmbedder),
// 在 dim()/embed() 的 match 中补对应分支（feature 门控）。
```

在 `Embedder` 定义与 `dim`/`embed` 的 match 中，用 `#[cfg(feature = "local-embed")]` 补 `Local` 分支：`embed` 里调用 fastembed 的 `embed(texts, None)` 返回 `Vec<Vec<f32>>`。`build_embedder` 的 `"local"` 分支：

```rust
        "local" => {
            #[cfg(feature = "local-embed")]
            {
                let model = fastembed::TextEmbedding::try_new(Default::default())
                    .map_err(|e| format!("本地嵌入模型加载失败：{e}"))?;
                Ok(Embedder::Local(LocalEmbedder {
                    model: std::sync::Arc::new(parking_lot::Mutex::new(model)),
                    dim: 384, // bge-small / MiniLM 默认 384
                }))
            }
            #[cfg(not(feature = "local-embed"))]
            {
                Err("本地嵌入未启用：请以 --features local-embed 构建".into())
            }
        }
```

- [ ] **Step 3: 两种构建都要能编译**

Run: `cd src-tauri && cargo build`（默认，无 local-embed）
Expected: 通过（Local 分支被 cfg 排除）。
Run: `cd src-tauri && cargo build --features local-embed`
Expected: 通过（首次会拉取 fastembed，编译较久）。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/rag/embed.rs
git commit -m "feat(rag): 本地嵌入 LocalEmbedder（fastembed，可选 local-embed feature）"
```

---

### Task 8: 设置页嵌入配置 + 重建索引

**Files:**
- Modify: `src/pages/settings.tsx`（新增「检索 / 嵌入」区块）

**Interfaces:**
- Consumes: `ipc.ragBuildIndex`、`DEFAULT_EMBED_CONFIG`、localStorage `rework-embed-config`。

- [ ] **Step 1: 加嵌入配置区**

在 settings.tsx 的 AI 区块之后，加一个「检索 / 嵌入」卡片：provider 下拉（本地 local / 云 api / mock）、model 输入、（api 时）base_url+key、以及「重建索引」按钮。配置写入 `localStorage["rework-embed-config"]`（与 AskPane 读的 key 一致）。「重建索引」调用：

```tsx
  const rebuildIndex = async () => {
    const raw = localStorage.getItem("rework-embed-config");
    const cfg = raw ? JSON.parse(raw) : DEFAULT_EMBED_CONFIG;
    setRebuilding(true);
    try {
      const n = await ipc.ragBuildIndex(cfg);
      toast.success(`索引完成：${n} 个片段`);
    } catch (e) {
      toast.error(`索引失败：${String(e)}`);
    } finally {
      setRebuilding(false);
    }
  };
```

顶部 import `ipc`、`DEFAULT_EMBED_CONFIG`、`toast`（settings.tsx 现有 toast 用法照抄）。

- [ ] **Step 2: 类型/构建校验**

Run: `npx tsc --noEmit && npm run build`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/pages/settings.tsx
git commit -m "feat(rag): 设置页嵌入配置 + 重建索引按钮"
```

---

### Task 9: 端到端验证

**Files:** 无。

- [ ] **Step 1: 默认 mock 全链路**

Run: `npm run tauri dev`
Expected：设置页嵌入 provider 选 `mock` → 点「重建索引」→ toast「索引完成：N 个片段」。会话中枢切「问历史」→ 输入问题 → 出召回卡片（mock 向量下相似度较均匀，但链路应通、可跳转）。

- [ ] **Step 2: 回退验证**

删除 `app_data_dir/rag_vectors.bin`（或换 provider 使 model_id 失配）→「问历史」应显示「已回退关键词检索」并给出 Tantivy 结果。

- [ ] **Step 3: 云嵌入（可选）**

设置页选 `api` + 填 embeddings key/base_url + model `text-embedding-3-small` → 重建索引 → 提问，验证语义召回质量优于 mock。

- [ ] **Step 4: 本地嵌入（可选）**

以 `cargo tauri dev` 加 `--features local-embed`（或在 tauri.conf 指定）构建 → 选 `local` → 重建 → 提问，全程不出本机。

---

## Self-Review 摘要

- Spec 覆盖：分块 ✓T1；内存暴力余弦+bincode ✓T2；可切换嵌入(Api/Local/Mock) ✓T3+T7；Indexer 增量/去重 ✓T4（v1 全量重建；增量随 scan_cache 留待后续，spec 已列为时机优化）；rag_search+回退 ✓T5+T6；「问」模式+⌘K ✓T6（⌘K 深链 `?ask=` 可作后续小增强）；设置+重建 ✓T8；隐私(本地默认) ✓ mock/local 不出网。
- 无占位符：Rust 核心（chunk/cosine/embed/indexer/命令）与前端 AskPane 均完整代码；T7/T8 的 feature 门控与 UI 给出具体代码骨架与关键调用。
- 类型一致：`EmbedConfig`(Rust/TS)、`RagHit`(Rust `RagHit`/TS `RagHit`) 字段对齐（session_id/provider/role/snippet/score）；`model_id`/`VectorStore.load` 的 model+dim 校验在 T2/T3/T5 一致使用；命令名 `rag_build_index`/`rag_search` 前后端一致。
- 偏移说明：EmbeddingProvider 以 enum dispatch 实现（避免 async-trait），语义等价于 spec 的 trait 抽象。
