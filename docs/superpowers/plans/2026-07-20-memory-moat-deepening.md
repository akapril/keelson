# 记忆护城河深化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 记忆语义去重 + 写项目 `CLAUDE.md`/`AGENTS.md` 受管块注入（承接 #5 记忆账本两项留后）。

**Architecture:** Part A 复用 `rag::embed` 暴露 `embed_texts` 命令，前端在 `MemoryReviewDialog` 用余弦相似度替代字符级去重（失败回退）。Part B 新建 `commands/memory.rs`，镜像 git 钩子的受管块模式（HTML 注释标记 + 幂等替换），前端在项目工作台加同步条。

**Tech Stack:** Rust/Tauri v2、React 19/TS、vitest、cargo test。

## Global Constraints

- 注释/日志用中文；中性主题不硬编码颜色（用 `text-muted-foreground`/`border-border`/`bg-card` 等语义 token）。
- 受管块标记：`<!-- >>> rework-memories >>> -->` 与 `<!-- <<< rework-memories <<< -->`；只动块内，块外用户内容逐字保留。
- 语义去重阈值 cosine `0.86`；同 `scope` 即判重，**不看 kind**。
- 语义任一步失败静默回退字符级 `classifyCandidates`，绝不阻断确认。
- 注入集合 = `!superseded_by && (scope==="global" || (scope==="project" && project===projectId))`。
- 只写 `<repo>/CLAUDE.md` 与 `<repo>/AGENTS.md`，不碰任何全局文件。
- 构建 Rust 前先 `taskkill //IM pocketbase.exe //F`（**绝不**碰 rework.exe）；构建后 `git checkout -- src-tauri/Cargo.toml`（autocrlf 幽灵）。

---

### Task 1: Rust `embed_texts` 命令

**Files:**
- Modify: `src-tauri/src/commands/rag.rs`（文件尾加命令）
- Modify: `src-tauri/src/lib.rs`（`invoke_handler` 注册）
- Test: `src-tauri/src/commands/rag.rs`（`#[cfg(test)]`）

**Interfaces:**
- Consumes: `crate::rag::embed::build_embedder`（已 import）、`crate::rag::EmbedConfig`、`Embedder::embed(&[String]) -> Result<Vec<Vec<f32>>, String>`。
- Produces: `embed_texts(config: EmbedConfig, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String>`。

- [ ] **Step 1: 写命令**

在 `rag.rs` 末尾追加：
```rust
/// 通用文本嵌入：前端记忆语义去重用。空输入返回空；provider 未就绪返回 Err（前端据此回退字符级）。
#[tauri::command]
pub async fn embed_texts(config: EmbedConfig, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(vec![]);
    }
    let embedder = build_embedder(&config)?;
    embedder.embed(&texts).await
}
```

- [ ] **Step 2: 注册命令**

`lib.rs` 中 `commands::rag::rag_search,` 一行后加：
```rust
            commands::rag::embed_texts,
```

- [ ] **Step 3: 加测试**

在 `rag.rs` 追加：
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn embed_texts_empty_returns_empty() {
        let cfg = EmbedConfig { provider: "mock".into(), base_url: "".into(), api_key: "".into(), model: "m".into() };
        let out = embed_texts(cfg, vec![]).await.unwrap();
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn embed_texts_mock_returns_vectors_per_text() {
        let cfg = EmbedConfig { provider: "mock".into(), base_url: "".into(), api_key: "".into(), model: "m".into() };
        let out = embed_texts(cfg, vec!["a".into(), "b".into()]).await.unwrap();
        assert_eq!(out.len(), 2);
        assert!(!out[0].is_empty());
    }

    #[tokio::test]
    async fn embed_texts_unknown_provider_errors() {
        let cfg = EmbedConfig { provider: "nope".into(), base_url: "".into(), api_key: "".into(), model: "m".into() };
        assert!(embed_texts(cfg, vec!["a".into()]).await.is_err());
    }
}
```

- [ ] **Step 4: 编译+测试**

Run: `taskkill //IM pocketbase.exe //F ; cd src-tauri && cargo test --lib commands::rag 2>&1 | tail -20`
Expected: 3 个新测试 PASS，0 error。之后 `git checkout -- Cargo.toml`。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/rag.rs src-tauri/src/lib.rs
git commit -m "feat(memory): 暴露 embed_texts 命令（语义去重底座）[Rust]"
```

---

### Task 2: 前端语义去重纯函数 + 单测

**Files:**
- Modify: `src/features/memory/extract.ts`（新增 `cosine` / `classifyBySimilarity`，保留旧函数）
- Test: `src/features/memory/extract.test.ts`（追加）

**Interfaces:**
- Consumes: `MemoryCandidate`、`Memory`、`ClassifiedCandidate`（本文件已定义）。
- Produces:
  - `cosine(a: number[], b: number[]): number`
  - `classifyBySimilarity(candidates: MemoryCandidate[], existing: Memory[], candVecs: number[][], existVecs: number[][], threshold?: number): ClassifiedCandidate[]`

- [ ] **Step 1: 写测试（先失败）**

在 `extract.test.ts` 追加（import 补 `cosine, classifyBySimilarity`）：
```ts
describe("cosine", () => {
  it("同向量为 1", () => expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1));
  it("正交为 0", () => expect(cosine([1, 0], [0, 1])).toBeCloseTo(0));
  it("零向量为 0", () => expect(cosine([0, 0], [1, 1])).toBe(0));
});

describe("classifyBySimilarity", () => {
  const cand = (content: string, scope: "global" | "project" = "project") =>
    ({ content, kind: "fact", scope, confidence: 50 }) as MemoryCandidate;
  const mem = (id: string, content: string, scope: "global" | "project" = "project") =>
    ({ id, content, kind: "fact", scope, superseded_by: "" }) as unknown as Memory;

  it("与已有语义相同 → duplicateOf 命中 id", () => {
    const c = [cand("用中文写注释")];
    const e = [mem("m1", "注释使用中文")];
    const out = classifyBySimilarity(c, e, [[1, 0, 0]], [[1, 0, 0]], 0.86);
    expect(out[0].duplicateOf).toBe("m1");
  });

  it("语义不同 → fresh(null)", () => {
    const c = [cand("使用 Rust")];
    const e = [mem("m1", "使用 Python")];
    const out = classifyBySimilarity(c, e, [[1, 0, 0]], [[0, 1, 0]], 0.86);
    expect(out[0].duplicateOf).toBeNull();
  });

  it("跨 kind 也判重（同 scope、向量相近）", () => {
    const c = [{ content: "偏好深色", kind: "preference", scope: "project", confidence: 50 } as MemoryCandidate];
    const e = [mem("m1", "喜欢深色主题")]; // kind=fact
    const out = classifyBySimilarity(c, e, [[1, 0]], [[1, 0]], 0.86);
    expect(out[0].duplicateOf).toBe("m1");
  });

  it("不同 scope 不判重", () => {
    const c = [cand("同一句话", "global")];
    const e = [mem("m1", "同一句话", "project")];
    const out = classifyBySimilarity(c, e, [[1, 0]], [[1, 0]], 0.86);
    expect(out[0].duplicateOf).toBeNull();
  });

  it("批内重复 → duplicateOf 空串", () => {
    const c = [cand("第一条"), cand("第一条近义")];
    const out = classifyBySimilarity(c, [], [[1, 0], [1, 0]], [], 0.86);
    expect(out[0].duplicateOf).toBeNull();
    expect(out[1].duplicateOf).toBe("");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/features/memory/extract.test.ts 2>&1 | tail -15`
Expected: FAIL（`cosine is not a function`）。

- [ ] **Step 3: 实现**

在 `extract.ts` 末尾追加：
```ts
/** 余弦相似度；任一零向量或长度不匹配返回 0。 */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 语义去重：与字符级 classifyCandidates 同形，但用向量余弦判重。
 * 同 scope 且 cosine ≥ threshold 即视为重复（不看 kind）。向量按传入顺序与 candidates/existing 对齐。
 */
export function classifyBySimilarity(
  candidates: MemoryCandidate[],
  existing: Memory[],
  candVecs: number[][],
  existVecs: number[][],
  threshold = 0.86,
): ClassifiedCandidate[] {
  const freshIdx: number[] = []; // 已收 fresh 候选的下标（用于批内去重）
  return candidates.map((cand, ci) => {
    const cv = candVecs[ci] ?? [];
    // 命中已有：同 scope、最高相似度且过阈值
    let bestId: string | null = null;
    let best = threshold;
    existing.forEach((m, ei) => {
      if (m.superseded_by || m.scope !== cand.scope) return;
      const sim = cosine(cv, existVecs[ei] ?? []);
      if (sim >= best) {
        best = sim;
        bestId = m.id;
      }
    });
    if (bestId) return { candidate: cand, duplicateOf: bestId };
    // 批内重复
    const dupInBatch = freshIdx.some(
      (fi) => candidates[fi].scope === cand.scope && cosine(cv, candVecs[fi] ?? []) >= threshold,
    );
    if (dupInBatch) return { candidate: cand, duplicateOf: "" };
    freshIdx.push(ci);
    return { candidate: cand, duplicateOf: null };
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/features/memory/extract.test.ts 2>&1 | tail -15`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/features/memory/extract.ts src/features/memory/extract.test.ts
git commit -m "feat(memory): 语义去重纯函数 cosine/classifyBySimilarity + 单测"
```

---

### Task 3: `MemoryReviewDialog` 接语义去重（失败回退字符级）

**Files:**
- Modify: `src/features/memory/MemoryReviewDialog.tsx`
- Modify: `src/lib/tauri/ipc.ts`（加 `embedTexts`）

**Interfaces:**
- Consumes: `ipc.embedTexts`、`classifyBySimilarity`、`classifyCandidates`（回退）、`parseMemories`。
- Produces: 无对外新符号（仅改编排）。

- [ ] **Step 1: ipc 加 embedTexts**

`src/lib/tauri/ipc.ts` 中 `ragSearch` 附近加：
```ts
  // 通用文本嵌入（记忆语义去重用）
  embedTexts: (config: EmbedConfig, texts: string[]) =>
    invoke<number[][]>("embed_texts", { config, texts }),
```
（`EmbedConfig` 已 import。）

- [ ] **Step 2: Dialog 内加嵌入配置读取 + 语义分类**

在 `MemoryReviewDialog.tsx` 顶部（组件外）加：
```ts
import { DEFAULT_EMBED_CONFIG } from "@/types/rag";
import { classifyBySimilarity } from "./extract";

// 读设置页存的嵌入配置（与 AskPane 同源 localStorage）
function readEmbedConfig() {
  try {
    const raw = localStorage.getItem("rework-embed-config");
    return raw ? { ...DEFAULT_EMBED_CONFIG, ...JSON.parse(raw) } : DEFAULT_EMBED_CONFIG;
  } catch {
    return DEFAULT_EMBED_CONFIG;
  }
}
function hasRealEmbedding(c: ReturnType<typeof readEmbedConfig>): boolean {
  return c.provider === "local" || (c.provider === "api" && !!c.api_key);
}
```

- [ ] **Step 3: 替换分类逻辑**

将现有：
```ts
        const classified = classifyCandidates(parseMemories(reply), existing);
```
替换为：
```ts
        const cands = parseMemories(reply);
        let classified;
        const embedCfg = readEmbedConfig();
        if (cands.length > 0 && hasRealEmbedding(embedCfg)) {
          // 语义去重：一次批量嵌入 [候选 + 已有]，失败则回退字符级
          try {
            const texts = [...cands.map((c) => c.content), ...existing.map((m) => m.content)];
            const vecs = await ipc.embedTexts(embedCfg, texts);
            if (cancelled) return;
            if (vecs.length === texts.length) {
              const candVecs = vecs.slice(0, cands.length);
              const existVecs = vecs.slice(cands.length);
              classified = classifyBySimilarity(cands, existing, candVecs, existVecs);
            } else {
              classified = classifyCandidates(cands, existing);
            }
          } catch {
            classified = classifyCandidates(cands, existing);
          }
        } else {
          classified = classifyCandidates(cands, existing);
        }
```
（保留原有 `setItems(classified)` 及默认勾选逻辑不变；确认 `classifyCandidates` import 仍在。）

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit 2>&1 | tail -15`
Expected: 0 error。

- [ ] **Step 5: Commit**

```bash
git add src/features/memory/MemoryReviewDialog.tsx src/lib/tauri/ipc.ts
git commit -m "feat(memory): 提炼记忆改用语义去重，失败回退字符级"
```

---

### Task 4: Rust `commands/memory.rs` 受管块渲染/写入 + 单测

**Files:**
- Create: `src-tauri/src/commands/memory.rs`
- Modify: `src-tauri/src/commands/mod.rs`（`pub mod memory;`）
- Modify: `src-tauri/src/lib.rs`（注册两命令）

**Interfaces:**
- Produces:
  - `memory_write_project_files(repo_path: String, mems: Vec<MemLine>) -> Result<Vec<String>, String>`
  - `memory_project_files_status(repo_path: String) -> Result<MemFilesStatus, String>`
  - `MemLine { content, kind, scope }`（Deserialize）、`MemFilesStatus { claude_md, agents_md }`（Serialize）
  - 纯函数 `render_memories_block`、`replace_managed_block`

- [ ] **Step 1: 写文件**

创建 `src-tauri/src/commands/memory.rs`：
```rust
//! 记忆注入命令：把选定记忆写进项目根 CLAUDE.md / AGENTS.md 的受管块（HTML 注释标记，块外内容零改动）。
use std::path::Path;

const MARK_BEGIN: &str = "<!-- >>> rework-memories >>> -->";
const MARK_END: &str = "<!-- <<< rework-memories <<< -->";

#[derive(serde::Deserialize)]
pub struct MemLine {
    pub content: String,
    pub kind: String,
    pub scope: String,
}

#[derive(serde::Serialize)]
pub struct MemFilesStatus {
    pub claude_md: bool,
    pub agents_md: bool,
}

/// kind → 中文小节标题；顺序固定（fact/preference/decision/convention）。
fn kind_label(kind: &str) -> &'static str {
    match kind {
        "fact" => "事实",
        "preference" => "偏好",
        "decision" => "决策",
        "convention" => "约定",
        _ => "其他",
    }
}

/// 渲染受管块正文（不含标记行）。空记忆返回空串。按 kind 固定顺序分组。
pub fn render_memories_block(mems: &[MemLine]) -> String {
    if mems.is_empty() {
        return String::new();
    }
    let mut out = String::from("（rework 生成，请勿手改此块）\n");
    for k in ["fact", "preference", "decision", "convention"] {
        let group: Vec<&MemLine> = mems.iter().filter(|m| m.kind == k).collect();
        if group.is_empty() {
            continue;
        }
        out.push_str(&format!("\n### {}\n", kind_label(k)));
        for m in group {
            out.push_str(&format!("- {}\n", m.content.trim()));
        }
    }
    // 收尾未匹配到上述 kind 的（其他）
    let others: Vec<&MemLine> = mems
        .iter()
        .filter(|m| !["fact", "preference", "decision", "convention"].contains(&m.kind.as_str()))
        .collect();
    if !others.is_empty() {
        out.push_str("\n### 其他\n");
        for m in others {
            out.push_str(&format!("- {}\n", m.content.trim()));
        }
    }
    out.trim_end().to_string()
}

/// 幂等替换受管块：移除既有 BEGIN..END（含标记行），block 非空则末尾追加，空则净卸载。块外逐字保留。
pub fn replace_managed_block(content: &str, block: &str) -> String {
    // 先剥离既有块
    let mut kept: Vec<&str> = Vec::new();
    let mut skip = false;
    for line in content.lines() {
        let t = line.trim();
        if t == MARK_BEGIN {
            skip = true;
            continue;
        }
        if t == MARK_END {
            skip = false;
            continue;
        }
        if !skip {
            kept.push(line);
        }
    }
    let mut base = kept.join("\n");
    // 去掉尾部多余空白，稍后统一控制间隔
    while base.ends_with('\n') || base.ends_with(' ') {
        base.pop();
    }
    if block.is_empty() {
        // 净卸载：保留原内容尾换行风格（原有内容非空则补一个换行）
        if base.is_empty() {
            return String::new();
        }
        base.push('\n');
        return base;
    }
    let managed = format!("{MARK_BEGIN}\n{block}\n{MARK_END}\n");
    if base.is_empty() {
        managed
    } else {
        format!("{base}\n\n{managed}")
    }
}

fn write_one(path: &Path, block: &str) -> Result<bool, String> {
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    let next = replace_managed_block(&existing, block);
    std::fs::write(path, next).map_err(|e| format!("写入 {} 失败：{e}", path.display()))?;
    Ok(true)
}

/// 把记忆写进 <repo>/CLAUDE.md 与 <repo>/AGENTS.md 的受管块。返回写入的路径。
#[tauri::command]
pub fn memory_write_project_files(repo_path: String, mems: Vec<MemLine>) -> Result<Vec<String>, String> {
    let root = Path::new(&repo_path);
    if !root.is_dir() {
        return Err(format!("仓库路径不是目录：{repo_path}"));
    }
    let block = render_memories_block(&mems);
    let mut written = Vec::new();
    for name in ["CLAUDE.md", "AGENTS.md"] {
        let p = root.join(name);
        write_one(&p, &block)?;
        written.push(p.display().to_string());
    }
    Ok(written)
}

/// 查项目两文件是否含受管块。
#[tauri::command]
pub fn memory_project_files_status(repo_path: String) -> Result<MemFilesStatus, String> {
    let root = Path::new(&repo_path);
    let has = |name: &str| {
        std::fs::read_to_string(root.join(name))
            .map(|c| c.contains(MARK_BEGIN))
            .unwrap_or(false)
    };
    Ok(MemFilesStatus {
        claude_md: has("CLAUDE.md"),
        agents_md: has("AGENTS.md"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ml(content: &str, kind: &str, scope: &str) -> MemLine {
        MemLine { content: content.into(), kind: kind.into(), scope: scope.into() }
    }

    #[test]
    fn render_empty_is_empty() {
        assert_eq!(render_memories_block(&[]), "");
    }

    #[test]
    fn render_groups_by_kind_in_order() {
        let mems = vec![ml("偏好A", "preference", "global"), ml("事实B", "fact", "global")];
        let out = render_memories_block(&mems);
        // 事实小节应在偏好小节之前（固定顺序）
        let fi = out.find("### 事实").unwrap();
        let pi = out.find("### 偏好").unwrap();
        assert!(fi < pi);
        assert!(out.contains("- 事实B"));
        assert!(out.contains("- 偏好A"));
    }

    #[test]
    fn replace_appends_then_idempotent() {
        let orig = "# 我的项目\n\n一些说明\n";
        let block = "（rework 生成）\n### 事实\n- x";
        let once = replace_managed_block(orig, block);
        assert!(once.contains(MARK_BEGIN) && once.contains(MARK_END));
        assert!(once.contains("# 我的项目")); // 块外保留
        let twice = replace_managed_block(&once, block);
        assert_eq!(once, twice); // 幂等
    }

    #[test]
    fn replace_empty_block_uninstalls_keeps_foreign() {
        let with = replace_managed_block("# 标题\n", "### 事实\n- x");
        let cleaned = replace_managed_block(&with, "");
        assert!(!cleaned.contains(MARK_BEGIN));
        assert!(cleaned.contains("# 标题")); // 块外保留
    }
}
```

- [ ] **Step 2: 注册模块**

`src-tauri/src/commands/mod.rs` 中 `pub mod mcp;` 后加：
```rust
// 记忆注入命令（把记忆写进项目 CLAUDE.md/AGENTS.md 受管块）
pub mod memory;
```

- [ ] **Step 3: 注册命令**

`lib.rs` 中 `commands::rag::embed_texts,` 后加：
```rust
            commands::memory::memory_write_project_files,
            commands::memory::memory_project_files_status,
```

- [ ] **Step 4: 编译+测试**

Run: `taskkill //IM pocketbase.exe //F ; cd src-tauri && cargo test --lib commands::memory 2>&1 | tail -20`
Expected: 4 个测试 PASS，0 error。之后 `git checkout -- Cargo.toml`。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/memory.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(memory): 项目 CLAUDE.md/AGENTS.md 受管块注入命令 + 单测 [Rust]"
```

---

### Task 5: `MemoryFilesBar` + 挂载项目工作台

**Files:**
- Create: `src/features/memory/MemoryFilesBar.tsx`
- Modify: `src/lib/tauri/ipc.ts`（加两命令封装）
- Modify: `src/types/memory.ts`（加 `MemFilesStatus`）
- Modify: `src/features/board/ProjectWorkspace.tsx`（概览挂载）

**Interfaces:**
- Consumes: `ipc.memoryWriteProjectFiles`、`ipc.memoryProjectFilesStatus`、`listMemories`。
- Produces: `MemoryFilesBar({ repoPath, projectId })`。

- [ ] **Step 1: 类型**

`src/types/memory.ts` 末尾加：
```ts
/** 项目记忆注入文件状态（对应 Rust MemFilesStatus）。 */
export interface MemFilesStatus {
  claude_md: boolean;
  agents_md: boolean;
}
```

- [ ] **Step 2: ipc 封装**

`src/lib/tauri/ipc.ts` 中 `embedTexts` 附近加（补 import `MemFilesStatus`）：
```ts
  // 记忆注入项目文件
  memoryWriteProjectFiles: (
    repoPath: string,
    mems: { content: string; kind: string; scope: string }[],
  ) => invoke<string[]>("memory_write_project_files", { repoPath, mems }),
  memoryProjectFilesStatus: (repoPath: string) =>
    invoke<MemFilesStatus>("memory_project_files_status", { repoPath }),
```

- [ ] **Step 3: 组件**

创建 `src/features/memory/MemoryFilesBar.tsx`：
```tsx
// MemoryFilesBar —— 项目工作台：把「全局 ∪ 本项目」记忆同步进 <repo>/CLAUDE.md、AGENTS.md 受管块。
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/lib/tauri/ipc";
import { Button } from "@/components/ui/button";
import { listMemories } from "@/lib/pb/memory";
import type { MemFilesStatus } from "@/types/memory";

export function MemoryFilesBar({ repoPath, projectId }: { repoPath: string; projectId: string }) {
  const [status, setStatus] = useState<MemFilesStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    ipc.memoryProjectFilesStatus(repoPath).then(setStatus).catch(() => setStatus(null));
  };
  useEffect(refresh, [repoPath]);

  const sync = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const all = await listMemories();
      const mems = all
        .filter(
          (m) =>
            !m.superseded_by &&
            (m.scope === "global" || (m.scope === "project" && m.project === projectId)),
        )
        .map((m) => ({ content: m.content, kind: m.kind, scope: m.scope }));
      const written = await ipc.memoryWriteProjectFiles(repoPath, mems);
      toast.success(
        mems.length > 0
          ? `已同步 ${mems.length} 条记忆到 ${written.length} 个文件`
          : "无可注入记忆，已清空受管块",
      );
      refresh();
    } catch (e) {
      toast.error(`同步失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const synced = status && (status.claude_md || status.agents_md);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
      {synced ? (
        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-medium text-primary">
          🧠 记忆已注入 CLAUDE.md/AGENTS.md
        </span>
      ) : (
        <span className="text-muted-foreground">
          把「全局 + 本项目」记忆写进 <code className="font-mono">CLAUDE.md</code> /{" "}
          <code className="font-mono">AGENTS.md</code>（受管块，喂回 CLI）
        </span>
      )}
      <Button variant="ghost" size="xs" className="ml-auto" disabled={busy} onClick={() => void sync()}>
        {busy ? "同步中…" : synced ? "重新同步" : "同步记忆到文件"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: 挂载**

`ProjectWorkspace.tsx` 概览 tab「项目信息」卡片 `</div>`（第 239 行那个闭合 div）之后、`{/* 近期截止任务 */}` 之前插入：
```tsx
            {/* 记忆注入项目文件（仅绑定仓库时） */}
            {repoPath && <MemoryFilesBar repoPath={repoPath} projectId={project.id} />}
```
并在文件顶部 import：
```tsx
import { MemoryFilesBar } from "@/features/memory/MemoryFilesBar";
```

- [ ] **Step 5: 类型检查 + 构建实测**

Run: `npx tsc --noEmit 2>&1 | tail -15`
Expected: 0 error。

- [ ] **Step 6: Commit**

```bash
git add src/features/memory/MemoryFilesBar.tsx src/lib/tauri/ipc.ts src/types/memory.ts src/features/board/ProjectWorkspace.tsx
git commit -m "feat(memory): 项目工作台一键同步记忆到 CLAUDE.md/AGENTS.md"
```

---

## Self-Review 检查

- [x] Spec 覆盖：语义去重（Task 1-3）、受管块注入（Task 4-5）全覆盖。
- [x] 无占位符：每步含完整代码/命令/期望。
- [x] 类型一致：`MemLine`/`MemFilesStatus`/`classifyBySimilarity` 签名跨任务一致；`ipc.embedTexts` 在 Task 1 定义、Task 3 使用。
- [x] 约束落地：受管块 HTML 注释标记、cosine 0.86、同 scope 不看 kind、失败回退、只写项目文件、pocketbase kill + Cargo.toml checkout。
