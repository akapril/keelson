# 记忆护城河深化 · 设计（Memory Moat Deepening）

> 承接 2026-07-20 五大功能之 #5「跨厂商记忆账本 MVP」的两项留后：**语义去重** + **写项目 CLAUDE.md/AGENTS.md 受管块注入**。

**Goal:** 让提炼的记忆更少重复（语义级去重）、并真正喂回 CLI（写进项目根的 `CLAUDE.md`/`AGENTS.md` 受管块），而不止靠 MCP `search_memory` 拉取。

**Tech Stack:** Rust/Tauri v2 命令层（复用 `rag::embed`）+ 前端 React/TS（复用 `extract.ts` 纯函数套路 + `HookBar` 受管块 UI 范式）。

## 用户已决策的取舍

1. **注入目标**：**不写任何全局文件**（不碰用户真实 `~/.claude/CLAUDE.md`）；只写**项目根**的 `<repo>/CLAUDE.md` 与 `<repo>/AGENTS.md`。
2. **每个项目文件写入的记忆集合** = `scope=global` 的全部 ∪ `scope=project 且 project==该项目id` 的记忆（全局记忆适用所有项目，故也落到每个项目文件；未 superseded）。
3. **语义去重门槛**：同 `scope` 即可判重，**不管 kind**（跨 fact/preference/... 也可判重）。阈值 cosine **0.86**。
4. **触发**：手动。项目工作台「概览」加一个同步条（仿 `WorkspaceCommits` 的 `HookBar`），点按钮同步。非自动。

## Part A — 语义去重（升级现字符级）

### 数据流
`MemoryReviewDialog` 抽出候选后：
- 读 `localStorage["rework-embed-config"]`（EmbedConfig）；`hasRealEmbedding`（api+key 或 local）为真时走语义，否则回退现字符级 `classifyCandidates`。
- 语义路径：`texts = [...候选.content, ...已有记忆.content]` → 一次 `ipc.embedTexts(cfg, texts)` → 拆成候选向量 / 已有向量 → `classifyBySimilarity`。
- 任一步失败 → 回退字符级（不抛错、不阻断确认）。

### Rust
`src-tauri/src/commands/rag.rs` 加薄命令（复用 `build_embedder`）：
```rust
#[tauri::command]
pub async fn embed_texts(config: EmbedConfig, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() { return Ok(vec![]); }
    let embedder = build_embedder(&config)?;
    embedder.embed(&texts).await
}
```
在 `lib.rs` 注册 `commands::rag::embed_texts`。

### 前端 `src/features/memory/extract.ts`（新增纯函数，保留旧函数作兜底）
- `cosine(a: number[], b: number[]): number` —— 点积 / (‖a‖·‖b‖)；任一零向量返回 0。
- `classifyBySimilarity(candidates, existing, candVecs, existVecs, threshold=0.86): ClassifiedCandidate[]`：
  - 命中已有：同 `scope` 且 `cosine(candVec, existVec) >= threshold` → `duplicateOf = 命中记忆.id`（取最高相似度那条）。
  - 批内重复：与已收 fresh 候选同 scope 且 cosine ≥ 阈值 → `duplicateOf = ""`。
  - 否则 `duplicateOf = null`（fresh，收入 freshSoFar）。
  - 不再看 kind（按决策 3）。

`ipc.ts` 加 `embedTexts: (config, texts) => invoke<number[][]>("embed_texts", { config, texts })`。

## Part B — 写项目 `CLAUDE.md`/`AGENTS.md` 受管块注入（全新）

### 受管块（Markdown 用 HTML 注释标记，渲染不可见、块外内容零改动）
```
<!-- >>> rework-memories >>> -->
（rework 生成，请勿手改此块）
### 事实
- ...
### 偏好
- ...
<!-- <<< rework-memories <<< -->
```

### Rust `src-tauri/src/commands/memory.rs`（新文件）
```rust
const MARK_BEGIN: &str = "<!-- >>> rework-memories >>> -->";
const MARK_END: &str = "<!-- <<< rework-memories <<< -->";

#[derive(serde::Deserialize)]
pub struct MemLine { pub content: String, pub kind: String, pub scope: String }

#[derive(serde::Serialize)]
pub struct MemFilesStatus { pub claude_md: bool, pub agents_md: bool }
```
纯函数（可测）：
- `render_memories_block(mems: &[MemLine]) -> String`：按 kind 分组（fact→「事实」/preference→「偏好」/decision→「决策」/convention→「约定」，顺序固定），每条 `- {content}`；首行加「（rework 生成，请勿手改此块）」。空列表返回空串。
- `replace_managed_block(content: &str, block: &str) -> String`：移除既有 `MARK_BEGIN..MARK_END`（含标记行）后：`block` 非空→在末尾追加（用 `MARK_BEGIN\n{block}\nMARK_END`，前置一空行保证与原内容隔开）；`block` 空→只移除（净卸载）。幂等：对已含块内容重复调用结果稳定。块外内容逐字保留。

命令：
- `memory_write_project_files(repo_path: String, mems: Vec<MemLine>) -> Result<Vec<String>, String>`：
  - `block = render_memories_block(&mems)`。
  - 对 `<repo>/CLAUDE.md`、`<repo>/AGENTS.md` 各自：读原文（不存在按空串）→ `replace_managed_block` → 写回。返回实际写入的路径列表。
  - repo_path 非目录 → Err。
- `memory_project_files_status(repo_path: String) -> Result<MemFilesStatus, String>`：读两文件，判断是否含 `MARK_BEGIN`。

`mod.rs` 加 `pub mod memory;`；`lib.rs` 注册两命令。

### 前端
- `ipc.ts`：`memoryWriteProjectFiles(repoPath, mems)` / `memoryProjectFilesStatus(repoPath)`；类型 `MemLine`/`MemFilesStatus` 放 `src/types/memory.ts`。
- `src/features/memory/MemoryFilesBar.tsx`（仿 `HookBar`）：props `{ repoPath, projectId }`。
  - 挂载时 `memoryProjectFilesStatus` 取状态。
  - 「同步到 CLAUDE.md / AGENTS.md」按钮：`listMemories()` → 过滤 `!superseded_by && (scope==="global" || (scope==="project" && project===projectId))` → 映射 `{content,kind,scope}` → `memoryWriteProjectFiles(repoPath, mems)` → toast 报写入文件数 → 刷新状态。
  - 显示：已同步几条 / 覆盖哪些文件；无记忆时按钮仍可点（净卸载空块）。
- 挂载点：`ProjectWorkspace.tsx` 概览 tab「项目信息」卡片后，`{repoPath && <MemoryFilesBar repoPath={repoPath} projectId={project.id} />}`。

## 测试
- Rust：`render_memories_block`（分组顺序 + 空列表空串）；`replace_managed_block`（追加 / 幂等 / 空块净卸载 / 块外内容保留）。
- 前端 vitest：`cosine`（同向=1、正交=0、零向量=0）；`classifyBySimilarity`（命中已有 / fresh / 批内重复 / 跨 kind 判重）。

## 约束
- 注释中文；中性主题不硬编码颜色。
- PB 无关（memories 集合已存在，本轮不改 schema）。
- 受管块只动 `MARK_BEGIN..MARK_END` 之间，块外用户内容逐字不动。
- 语义失败静默回退字符级，绝不阻断记忆确认。
