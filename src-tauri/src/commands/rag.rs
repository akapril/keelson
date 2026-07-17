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
    // 嵌入配置失效也降级为空（与其它失败路径一致），让前端回退关键词检索，而非抛命令错误
    let embedder = match build_embedder(&config) {
        Ok(e) => e,
        Err(_) => return Ok(vec![]),
    };
    let path = match vec_path(&app) {
        Ok(p) => p,
        Err(_) => return Ok(vec![]),
    };
    // 先嵌入 query，以其实际维度加载向量库（infer_dim 对云端可能猜错，实际向量长度才准）
    let qv = match embedder.embed(&[query]).await {
        Ok(mut v) if !v.is_empty() => v.remove(0),
        _ => return Ok(vec![]),
    };
    let store = match VectorStore::load(&path, &model_id(&config), qv.len()) {
        Some(s) => s,
        None => return Ok(vec![]), // 未建/失效 → 空，前端回退
    };
    // 取较大候选后按会话去重成 limit 条
    let raw = store.search(&qv, (limit as usize) * 3);
    Ok(hits_from(raw, 1).into_iter().take(limit as usize).collect())
}
