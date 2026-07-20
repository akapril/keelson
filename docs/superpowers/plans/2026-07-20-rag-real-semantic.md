# RAG 真语义检索：设计 + 分阶段实现计划

> 日期：2026-07-20 · 分支基线：`feat/board`
> 目标：让「问历史」（`AskPane`）的**真语义召回真正可用**，而非停留在 mock 假向量 / 关键词兜底。
> 本文只做设计与实现规划，**不含代码**。

---

## 1. 现状核实（已逐文件确认）

| 层 | 文件 | 关键事实 |
|---|---|---|
| 前端问模式 | `src/features/sessions/AskPane.tsx` | `hasRealEmbedding(cfg)` 判定：`provider==="local"` 或 `provider==="api" && api_key`。真语义走 `ipc.ragSearch`，空则回退 `searchSessions`（关键词）；未配置真语义（默认 mock）直接关键词，UI 诚实标注 `kw-only`。 |
| 前端配置 | `src/types/rag.ts` | `EmbedConfig{provider,base_url,api_key,model}`；`DEFAULT_EMBED_CONFIG.provider="mock"`，model 预填 `text-embedding-3-small`。 |
| 前端设置页 | `src/pages/settings.tsx` L313–369, L606–694 | localStorage key `rework-embed-config`（扁平当前值）+ `rework-embed-by-provider`（各商快照）。UI 提供 local/api/mock 三选、api 时显示 base_url/api_key、模型输入框（所有 provider 可见）、「重建索引」按钮。**未监听 `rag-index-progress` 事件**，只在完成后 toast 片段数。 |
| 前端 AI 配置 | `src/types/ai.ts`、`src/store/settings.ts` | `AiConfig{provider,base_url,api_key,model,cli_path}`，`provider∈{openai,anthropic,claude-cli,codex-cli}`。按 provider 隔离持久化。**与 embed 配置完全独立，无任何联动。** |
| 前端 IPC | `src/lib/tauri/ipc.ts` L128–133 | `ragSearch(config,query,limit)` → `rag_search`；`ragBuildIndex(config)` → `rag_build_index`。 |
| Rust 命令 | `src-tauri/src/commands/rag.rs` | `rag_build_index`：全量 `state.sessions` → `build_store` → 存 `app_data_dir/rag_vectors.bin`，emit `rag-index-progress`（开始=会话数，完成=0）。`rag_search`：**任何失败/未就绪均返回空 `Ok(vec![])`**，让前端回退。query 先嵌入拿到真实维度再 `VectorStore::load` 校验 model_id+dim。 |
| Rust 嵌入 | `src-tauri/src/rag/embed.rs` | `build_embedder(cfg)`：`api`(OpenAI 兼容 `/embeddings`，`infer_dim` 猜维度)、`mock`(384 维假向量)、`local`(fastembed AllMiniLML6V2 384 维，`#[cfg(feature="local-embed")]`，**未启用则 `build_embedder` 返回 Err**)。`model_id = "{provider}:{model}"`。 |
| Rust 存储 | `src-tauri/src/rag/store.rs` | 内存全量向量 + 暴力余弦 Top-K，bincode 落盘。`load` 校验 `model_id && dim`，不符返回 None（失效重建）。 |
| Rust 分块 | `src-tauri/src/rag/chunk.rs` | 仅索引 `user_messages`，块 800 字符、每会话封顶 60 块，按字符切（UTF-8 安全）。 |
| Rust 索引器 | `src-tauri/src/rag/indexer.rs` | 分批 64 嵌入，校验返回数=请求数，用**首个向量实际长度回填 dim**（补偿 `infer_dim` 猜错）。 |
| Cargo | `src-tauri/Cargo.toml` L46,51 | `fastembed = { version="4", optional=true }`；`[features] local-embed = ["dep:fastembed"]`。**默认 features 不含 local-embed，故 `local` 分支未编进二进制。** |

**核心结论**：管线（分块→嵌入→存储→检索→回退）**已完整且健壮**，唯一缺口是「让用户便捷地拿到一个能产真语义向量的 embedder」。`api` 路径代码已通但需用户手填 key；`local` 路径代码已写但**默认没编进去**，选它会命令报错（被 search 静默吞成空 → 一直关键词兜底，用户以为语义坏了）。

---

## 2. 设计取舍：两条主线

### 主线 A —— 复用 AI 对话的 key 做 embeddings
用户在 AI 对话已配了 OpenAI 兼容 key（`aiConfig.provider==="openai"` 且有 `api_key`）时，一键把同一 `base_url + api_key` 灌进 `EmbedConfig(provider="api")`，model 用 `text-embedding-3-small`。

- 优点（KISS/YAGNI）：**零新增 Rust 代码、零下载、零二进制膨胀**；`api` 路径本就跑通。对已配 OpenAI 的用户是「一个按钮的事」。
- 缺点：数据出本机（片段发往云端）；仅对 OpenAI 兼容 provider 有效（anthropic 无 `/embeddings` 兼容端点、claude-cli/codex-cli 无 key，需灰置）；依赖网络与 key 额度。

### 主线 B —— 默认编进 local-embed（fastembed 离线）
把 `local-embed` 加入默认 features，`local` 直接可用，数据不出本机。

- 优点：**隐私优先**（片段永不出本机）；离线可用；无 API 成本。
- 缺点（YAGNI 警示）：首次调用**下载 ~90MB ONNX 模型**（fastembed 默认拉到缓存目录）；二进制显著变大（onnxruntime 依赖）；编译时间 / CI 负担上升；跨平台需验证 onnxruntime 动态库随包分发。**这是最重的一次拍板，需用户明确同意二进制体积代价。**

### 推荐：A 立即做（P0），B 作为可选开关渐进（P1，默认关）
理由（SOLID-OCP / YAGNI）：
- A 用最小改动立刻把「真语义」从不可用变可用，命中「用户多半已配 OpenAI key」的现实。
- B 价值真实（隐私 + 离线）但代价重，且**是否默认编入涉及二进制体积的产品决策**，不应在本轮擅自替用户拍板。因此 B 先以 feature flag 存在、构建可选，把「是否设为默认 features / 是否随包分发模型」显式抛给用户。
- 两者不互斥：A 快、B 私密，最终可共存，用户在设置页自选 provider。

---

## 3. 关键设计细节

### 3.1 embed 配置与 aiConfig 的关系
保持**两份配置独立**（避免耦合导致改 AI 影响检索，符合单一职责），但在设置页嵌入区提供**单向一键同步**：「复用 AI 对话的 OpenAI 密钥」按钮 → 读 `useSettingsStore.aiConfig`，若为 OpenAI 兼容且有 key，则 `setEmbed({provider:"api", base_url, api_key, model:"text-embedding-3-small"})`。不做自动/隐式同步（用户可能故意用不同 key/额度）。按钮仅在 `aiConfig` 满足条件时可用，否则灰置并提示原因。

### 3.2 索引构建 UX
- **何时建**：不自动全量建（会话可能几百上千，云端 embeddings 有成本/延迟）。保持**显式「重建索引」**触发，但补齐反馈。
- **进度**：`rag_build_index` 已 emit `rag-index-progress`（开始=会话数、完成=0），但前端未监听。→ 设置页 `listen("rag-index-progress")` 显示「索引中… / 完成 N 片段」。当前事件语义较弱（只有开始/结束两点），P0 先接上现有事件；若需真进度条，P2 再在 `build_store` 分批循环里 emit 已处理块数（Rust 改动）。
- **失效重建**：`VectorStore::load` 已在 model_id/dim 不符时返回 None → search 空 → 前端回退关键词。用户切 provider/model 后，旧索引自动失效，UI 应提示「嵌入配置已变，请重建索引」。P0 用前端启发式：记录「上次成功建索引时的 model_id」到 localStorage，与当前 `provider:model` 比对，不一致则在 AskPane / 设置页显示「索引可能过期」提示。

### 3.3 维度不一致处理
已由 `indexer.rs` 用**首向量实际长度回填 dim** + `rag_search` 先嵌入 query 拿真实维度再 load 解决。`infer_dim` 仅作 `ApiEmbedder` 初值，不影响正确性。**本轮无需改**，仅在文档标注该机制已覆盖用户填任意 model（如 `bge-*`、第三方 1024 维）的情况。

### 3.4 错误与回退（诚实化收尾）
现状 `rag_search` 把「local 未编译」这类**配置性错误也静默吞成空**，导致用户选了 local 却一直走关键词、无从得知原因。改进：
- 若 `provider==="local"` 且二进制未含 `local-embed` feature → 应让用户**在设置页就看到明确报错**（而非仅在 search 时静默）。P0 在设置页「重建索引」时不吞 `build_embedder` 的 Err，直接 toast 原因（`rag_build_index` 本就返回 Err，前端已 catch → 只需确保 local 未启用时下拉项被禁用或标注「当前构建未包含」）。
- 保留 `rag_search` 的「失败即空回退关键词」策略（对最终用户体验友好），但**在设置页构建路径把错误显性化**，两条路径分工清晰。

### 3.5 设置页改动汇总（前端）
1. 嵌入区新增「复用 AI 对话密钥」按钮（主线 A 入口）。
2. `listen("rag-index-progress")` 显示索引进度 / 完成态。
3. 记录并比对 `lastIndexedModelId`，过期时提示重建。
4. `local` 下拉项：若前端能得知构建未含 local-embed，则禁用并标注「本构建未包含本地嵌入」；判断来源见 3.6。

### 3.6 前端如何得知 local 是否可用
新增只读 Rust 命令 `rag_capabilities()` → 返回 `{ local_embed_built: bool }`（用 `cfg!(feature="local-embed")` 常量判断，无副作用）。设置页启动查询一次，据此启用/禁用 local 选项并给文案。避免「选了才在 build 时才知道不行」。

---

## 4. 分阶段实现计划

> 标注 **[RUST]** 的任务需重新编译 `src-tauri`（Windows 注意：先杀 `pocketbase*` 释放构建目录锁，见项目 gotcha 记忆）。其余为纯前端。

### 阶段 P0 — 主线 A 可用 + 诚实化收尾（纯前端为主，最高优先）
| # | 任务 | 改动文件 | 要点 | 验证 |
|---|---|---|---|---|
| P0-1 | 「复用 AI 对话密钥」按钮 | `src/pages/settings.tsx` | 读 `useSettingsStore.getState().aiConfig`；仅当 `provider==="openai" && api_key` 时可用；点击 `setEmbed({provider:"api",base_url,api_key,model:"text-embedding-3-small"})`；否则灰置 + tooltip 说明原因 | 已配 OpenAI key → 点按钮后嵌入区变 api 且字段填好；AskPane `hasRealEmbedding` 返回 true |
| P0-2 | 索引进度反馈 | `src/pages/settings.tsx` | `listen("rag-index-progress")`：>0 显示「索引中…（N 会话）」，=0 显示完成；卸载时 unlisten | 点重建 → 看到进度态 → 完成 toast |
| P0-3 | 索引过期提示 | `src/pages/settings.tsx`、`src/features/sessions/AskPane.tsx` | 建成功后写 `localStorage["rework-rag-indexed-model"]=`当前 `provider:model`；两处比对当前 cfg，不一致显示「嵌入配置已变，请重建索引」 | 建索引后切 model → 出现过期提示 |
| P0-4 | 端到端语义验证 | —（手动） | 配真实 OpenAI key → 重建 → 在 AskPane 提问，确认 `retrieval==="semantic"` 且相似度合理 | UI 标「相似度」而非「相关度」，命中语义相关而非仅关键词 |

### 阶段 P1 — 主线 B 可选启用（local-embed 渐进，默认关）
| # | 任务 | 改动文件 | 要点 | 验证 |
|---|---|---|---|---|
| P1-1 **[RUST]** | 能力探测命令 | `src-tauri/src/commands/rag.rs`、`lib.rs`（注册）、`src/lib/tauri/ipc.ts`、`src/types/rag.ts` | 新增 `rag_capabilities()` 返回 `{local_embed_built: cfg!(feature="local-embed")}`，无副作用 | 默认构建返回 false；`--features local-embed` 返回 true |
| P1-2 | local 选项按能力启用 | `src/pages/settings.tsx` | 启动查 `rag_capabilities`；`local_embed_built===false` 时禁用 local 项并标注「本构建未包含本地嵌入」 | 默认构建 local 禁用；带 feature 构建可选 |
| P1-3 **[RUST]** | 本地构建 / 打包脚本文档化 | `src-tauri/Cargo.toml`（不改默认）、构建脚本 / CI 说明 | 记录 `cargo build --features local-embed` 与 tauri 打包命令；验证首次运行下载 ~90MB 模型的缓存路径与离线行为 | 带 feature 打包后选 local → 首次下载模型 → 语义可用、断网仍可用 |
| P1-4 **[RUST]（可选）** | 首次模型下载进度 | `src-tauri/src/rag/embed.rs` | `LocalEmbedder` 构建时 `with_show_download_progress` + 事件透出，避免首次「卡住」 | 首次建 local 索引时前端有下载提示 |

### 阶段 P2 — 打磨（可选，YAGNI 门槛，按需）
| # | 任务 | 改动文件 | 要点 |
|---|---|---|---|
| P2-1 **[RUST]** | 细粒度索引进度 | `src-tauri/src/rag/indexer.rs`、`commands/rag.rs` | 在 64 批循环里 emit 已处理块数 / 总数，前端显真进度条 |
| P2-2 | 索引元信息展示 | `settings.tsx` + 新命令或读文件 | 显示「已索引 N 片段 / 建于 X 时间 / 用 model Y」，替代仅靠 localStorage 猜过期 |
| P2-3 | assistant 消息入索引（召回质量） | `src-tauri/src/rag/chunk.rs` | 现仅索引 `user_messages`；评估是否纳入 assistant 回复以提升召回（权衡索引量与成本） |

---

## 5. 需用户拍板的决策点

1. **【最重】主线 B 是否默认编进 features？** 推荐**否**（保持 optional，P1 仅让「带 feature 构建」时可用）。若用户要「开箱即用离线语义」，需接受二进制显著变大 + 首次 ~90MB 下载。**是否容忍二进制体积膨胀？**
2. **主线 A 是否作为 P0 立即落地？** 推荐**是**（零 Rust 改动、命中已配 OpenAI key 的多数用户）。
3. **「复用 AI 密钥」是一键手动还是自动同步？** 推荐**一键手动**（保留用户用不同 key/额度的自由），不做隐式自动。
4. **是否随安装包分发 ONNX 模型（vs 首次运行下载）？** 影响包体与离线首启体验；仅在选定启用 B 时才需决定。
5. **是否把 assistant 消息也纳入索引（P2-3）？** 影响召回质量与索引规模/云端成本，需要拍板。
6. **P0 是否包含新增 Rust 能力探测命令（`rag_capabilities`）？** 若只做主线 A，可延到 P1；但它能避免「选了 local 却静默失败」的困惑，建议随 P1 一起。

---

## 6. 风险与回退
- A 依赖第三方 `/embeddings` 兼容性：非官方 base_url 若不兼容，`build_store` 会在解析响应处报错 → 设置页 toast 可见；search 侧仍安全回退关键词。
- B 的 onnxruntime 跨平台动态库分发是打包主要风险，须在 P1-3 实测三平台。
- 全程保持「search 失败即空 → 关键词兜底」不变，任何嵌入问题都不会让「问历史」完全不可用，只是降级为关键词。
