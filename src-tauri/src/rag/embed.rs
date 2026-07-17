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

/// 本地 ONNX 嵌入（fastembed）：仅在 local-embed feature 启用时编译。
#[cfg(feature = "local-embed")]
pub struct LocalEmbedder {
    model: std::sync::Arc<parking_lot::Mutex<fastembed::TextEmbedding>>,
    pub dim: usize,
}

pub enum Embedder {
    Api(ApiEmbedder),
    Mock(MockEmbedder),
    #[cfg(feature = "local-embed")]
    Local(LocalEmbedder),
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
            #[cfg(feature = "local-embed")]
            Embedder::Local(e) => e.dim,
        }
    }

    pub async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        match self {
            Embedder::Mock(e) => Ok(texts.iter().map(|t| e.embed_one(t)).collect()),
            #[cfg(feature = "local-embed")]
            Embedder::Local(e) => {
                // fastembed 的 embed 是同步调用，通过 Arc<Mutex> 防并发
                let vectors: Vec<Vec<f32>> = e
                    .model
                    .lock()
                    .embed(texts.to_vec(), None)
                    .map_err(|err| format!("本地嵌入推理失败：{err}"))?;
                Ok(vectors)
            }
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
        "local" => {
            // local-embed feature 启用时构建 LocalEmbedder，否则报友好错误
            #[cfg(feature = "local-embed")]
            {
                use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
                let model = TextEmbedding::try_new(
                    InitOptions::new(EmbeddingModel::AllMiniLML6V2)
                        .with_show_download_progress(false),
                )
                .map_err(|e| format!("本地嵌入模型加载失败：{e}"))?;
                Ok(Embedder::Local(LocalEmbedder {
                    model: std::sync::Arc::new(parking_lot::Mutex::new(model)),
                    dim: 384, // AllMiniLML6V2 = 384 维
                }))
            }
            #[cfg(not(feature = "local-embed"))]
            {
                Err("本地嵌入未启用：请以 --features local-embed 构建".into())
            }
        }
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
