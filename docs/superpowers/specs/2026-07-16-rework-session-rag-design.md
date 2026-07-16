# rework 跨会话语义检索 RAG —— 设计

> 护城河特性:把用户全部本地 Claude Code / Codex 会话历史变成可语义搜索的知识库。
> 场景:"上次我怎么解决 X 的" → 语义召回相关会话片段 +（可选）AI 综合回答 + 跳转来源会话。
> 隐私原则:会话正文留本机;默认本地嵌入,正文不发第三方。

## 决策纪要（脑暴结论）

| 维度 | 决定 |
|---|---|
| 向量数据库 | **不用**（YAGNI）。v1 内存暴力余弦 + 本地向量文件持久化;sqlite-vec 作后续可选 |
| 嵌入 provider | **可切换**:默认本地 fastembed（离线/隐私）/ 云 embedding API |
| 索引内容 | user + assistant 消息,按消息分块、单块限长、每会话封顶 |
| 交互形态 | 会话中枢加"问"模式（与搜索并列）+ ⌘K 快速入口 |
| 结果呈现 | **永远先给语义召回列表**（全本地、秒出）;配了 AI 再在顶部综合答案 + 引用 |
| 二进制体积取舍 | 默认本地 fastembed（链接 ONNX 运行时,体积变大;模型按需下载）;云嵌入可选。**接受体积成本，优先隐私**（可后续 feature 开关） |

## 架构总览

新增 Rust 模块 `rag`,由三部分组成,各自单一职责、接口清晰:

1. **`EmbeddingProvider`（trait）** — 把文本批量转成向量。实现:
   - `LocalEmbedder`（fastembed，默认;模型首次按需下载到缓存目录）
   - `ApiEmbedder`（OpenAI 兼容 embeddings,需 key）
2. **`VectorStore`** — 存/检索向量。v1 实现 `MemoryStore`:向量持有在内存 `Vec`,持久化到本地 `rag_vectors.bin`（bincode）。检索 = 暴力余弦 Top-K。（后续可加 `SqliteVecStore`。）
3. **`Indexer`** — 把会话分块、调 EmbeddingProvider、写 VectorStore;跟随 `scan_cache` 增量。

数据流:
```
会话(.jsonl 本地) → scanner → 分块(chunk) → EmbeddingProvider.embed → VectorStore
                                                              ↑ 增量(仅新增/变化会话)
问：query → EmbeddingProvider.embed_query → VectorStore.search(topK) → 片段
        → 前端展示召回卡片 →(可选) provider 综合答案 + 引用
```

复用现有:`scanner`/`scan_cache`（会话发现 + 增量指纹）、`models::Session.user_messages`、AI provider 层（含 P0 本地 CLI）、`sessions_timeline`（跳转/取全文）。

## 1) 索引管线

**分块（纯逻辑,可测）**
- 输入:一个会话的时间线消息（user + assistant）。
- 规则:每条消息成块;超过 `MAX_CHUNK_CHARS`（~800 字）按边界切多块;每会话最多 `MAX_CHUNKS_PER_SESSION`（如 60）块,防超长会话爆量。
- 块结构:`Chunk { session_id, provider, role, seq, text }`。

**嵌入**
- `EmbeddingProvider.embed(texts: &[String]) -> Vec<Vec<f32>>`,批量。
- 本地:fastembed 默认模型（如 bge-small / all-MiniLM,384 维）。
- 云:POST embeddings 接口。

**存储 + 检索**
- `MemoryStore`:`Vec<StoredVec { chunk_meta, vector }>`。
- 检索:query 向量与全量做余弦,取 Top-K；K 默认 20，跨会话去重后取代表片段。
- 持久化:`app_data_dir/rag_vectors.bin`（bincode）,含**嵌入 provider/模型标识 + 维度**;provider/模型变更 → 索引失效重建。

**时机 / 增量**
- 启动后台任务:读缓存 → 对 `scan_cache` 判定为新增/变化的会话（mtime）重新分块+嵌入,写入 store；未变化的复用已存向量。
- 首次全量嵌入在后台进行（进度可经事件上报）;期间"问"回退关键词检索。

## 2) 检索与回答

**命令** `rag_search(query, limit) -> Vec<RagHit>`
- `RagHit { session_id, provider, role, snippet, score }`。
- 索引未就绪 / 嵌入失败 → 返回空 → 前端回退 `sessions_search`（Tantivy 关键词）。

**前端流程（会话中枢"问"模式）**
1. 输入问题 → `ipc.ragSearch(query)` → 得到片段。
2. **总是**渲染召回的会话片段卡片（按 session 分组,点击跳会话,复用 `?session=` 深链）。
3. **若配置了 AI**:把 Top-K 片段拼成上下文,调 provider（**优先本地 CLI,全程不出本机**）综合成一段答案,答案里用 `[1][2]` 引用编号对应下方卡片。
4. 停止/失败:答案区显示错误,召回卡片不受影响。

## 3) 交互

- **会话中枢**:搜索框区域加 `搜索 | 问` 切换。"问"模式复用上面的流程,答案+卡片显示在列表区。
- **⌘K**:输入以 `?` 结尾或点"问历史"→ 跳转 `/sessions?ask=<query>`,会话中枢读 `ask` 参数进入问模式并自动执行。

## 4) 设置

- 「AI 助手」区旁加「检索/嵌入」:嵌入 provider（本地/云 + 模型名 + 云的 base_url/key）+「重建索引」按钮 + 索引状态（已嵌入 N 会话 / 后台进行中）。

## 5) 隐私

- 本地嵌入 + 本地 CLI 综合 = **全程不出本机**（默认路径）。
- 选云嵌入 → 会话片段发送到云 embedding 接口;选云 AI 综合 → 召回片段发云。UI 明示当前数据去向。
- 向量文件在本机 `app_data_dir`,随用户数据。

## 6) 错误处理 & 测试

- 回退链:索引未就绪 / 嵌入不可用 → Tantivy 关键词检索；无 AI → 仅召回列表。
- 可测纯逻辑:分块（边界/限长/封顶,含中英/多字节）、余弦 Top-K 排序、引用编号拼装。
- EmbeddingProvider/VectorStore 走 trait,单测用 mock 向量验证检索排序,不依赖真模型。

## 依赖与前置

- **前置 P0（本地 CLI provider）**:让"综合答案"能用本地 claude/codex 订阅、隐私最优。RAG 不强依赖它（也能用云 AI 或纯召回),但两者组合是最佳形态,故实现计划中 P0 在 ② 之前。
- 新增 crate:`fastembed`（含 ort/ONNX,体积成本）、`bincode`。sqlite-vec 暂不引入。

## 非目标（YAGNI）

- 不做重型向量数据库、不做跨机器同步索引、不做实时协作检索、不做 assistant 回复的自动摘要压缩（先原文分块）。

## 配套（不在本 spec,进实现计划一起排期）

- **P0 本地 CLI provider**:Rust `cli_chat` shell 调 `claude -p` / `codex exec`;设置页加「Claude Code/Codex（本地）」provider。
- **① 用量/成本控制塔**:聚合 `total_tokens`/provider/时间 → 趋势图 + 估算成本。纯前端为主。
- 执行顺序建议:**P0 →（或并行）① → ②(本 spec)**。
