# 用量成本塔 · 按模型维度 — 设计 + 实现计划

> 状态：待评审（本文档只做设计与计划，不含任何代码）
> 关联：`docs/superpowers/plans/2026-07-16-usage-cost-tower.md`（成本塔 v1）
> 日期：2026-07-20

---

## 1. 背景与动机

成本塔 v1（`src/pages/usage.tsx` + `src/features/usage/aggregate.ts`）已实现：

- 按天 token 趋势（`daily`）
- 按 provider 分布（`byProvider`，含单价编辑）
- 按项目分布（`byProject`，刚加）

**核心缺口**：成本只按 provider 一个单价估算（`CostRates: provider → 每百万单价`），但同一 provider（尤其 Claude）下 **opus 与 sonnet 单价相差约 5 倍**。混在一个 provider 里，用户看不出"到底是 opus 烧的钱还是 sonnet"，成本归因失真。

目标：新增 **按模型维度** 的 token 与成本视图，让单价可按模型配置。

---

## 2. 代码现状核实（已实证）

以下均已通过读源码 + 解析本机真实会话文件核实。

### 2.1 解析层：模型与 token 字段的真实位置

**Claude（`src-tauri/src/providers/claude.rs::parse_session_file`）**
- 逐行读 session `.jsonl`；`type=="assistant"` 的行里：
  - 模型：`/message/model`，例如 `claude-opus-4-8`（**每条 assistant 消息都带**，可精确按模型归因）
  - 用量：`/message/usage`，当前代码只累加 `input_tokens + output_tokens` → `total_tokens`。
- ⚠️ **实证发现**：真实 usage 还含 `cache_creation_input_tokens`、`cache_read_input_tokens`，且**量级远大于 input_tokens**（样本：input=2、cache_creation=18273、cache_read=0、output=1）。当前 `total_tokens` **系统性低估**了 Claude 实际用量与成本。这是本次要顺带决策的点（见 §7 决策 D4）。
- 结论：Claude **可做到真正的"按模型拆 token"**，甚至可拆 input/output/cache 四类。

**Codex（`src-tauri/src/providers/codex.rs::scan_codex_session`）**
- 模型：**不在** `session_meta`，而在 `turn_context` 行的 `payload.model`，例如 `gpt-5.1-codex-max`；`session_meta.payload` 只有 `model_provider`（如 `openai`）。model 可能出现在多条 `turn_context`（理论上支持中途切模型）。
- 用量：`event_msg` 且 `payload.type=="token_count"` 的 `info.total_token_usage.{input_tokens,output_tokens}`，是**会话级累计值**，取最后一条为总量。**不随模型拆分**。
- ⚠️ **实证发现**：扫描本机最近 30 个 Codex 会话，**0 个使用超过 1 个模型**。即 Codex 现实中"一会话一模型"。因此对 Codex，把"整会话 token 归到该会话唯一模型"是准确且足够的近似；无需按 turn 精细拆分。

### 2.2 数据模型与缓存

- `Session`（`src-tauri/src/models.rs`）：有 `total_tokens: u64`，**无 model / by_model 字段**。
- `SessionMeta`（同文件）：PB 同步用精简视图，同样无模型字段。
- `scan_cache.rs`：`CacheData { version, cached_at, sessions: Vec<Session> }`，直接 serde 序列化 `Session`。`CACHE_VERSION = 1`。**版本不符即整体作废退回全量扫描**。
- `sync.rs::build_scan_fields`：只写 `session_id/provider/project_path/project_name/last_prompt/message_count/total_tokens/content_hash/orphaned`。**不涉及新字段则完全不受影响**（除非我们要把模型也同步到 PB —— 本期不做）。

### 2.3 前端

- `src/types/session.ts::Session`：镜像 Rust，snake_case，无模型字段。
- `src/features/usage/aggregate.ts`：`aggregateUsage()` 产出 `UsageSummary{ byProvider, byProject, daily, ... }`；成本 `estimateCost(tokens, ratePerMillion)`。
- 单价存储：`src/store/cost.ts`（zustand + localStorage，key `rework-cost-config`）；`CostConfig{ rates: {provider→单价}, currency }`；默认 `{ claude:3, codex:2, openai:0.6, anthropic:3 }`。
- 测试：`src/features/usage/aggregate.test.ts`（vitest，纯函数）。

---

## 3. 设计目标与非目标

**目标**
- Session 新增 `by_model: 模型名 → token 数`，解析层按模型累加。
- 前端新增"按模型"图表 + 列表，单价可**按模型**配置。
- 旧 scan_cache 平滑兼容（不因加字段全量重扫失败）。
- 保持 `aggregate` 纯函数可测风格。

**非目标（YAGNI）**
- 不把模型信息同步到 PocketBase（`sync.rs` 不动）。
- 不做跨设备的单价云端同步（仍 localStorage）。
- 不为 Codex 做 turn 级精细 token 拆分（实证一会话一模型，收益≈0）。
- 不做历史成本预算/告警（后续独立需求）。

---

## 4. 数据流设计

```
解析层 (claude.rs / codex.rs)
  ├─ Claude: 遍历 assistant 行 → model=/message/model, tok=input+output(+cache?) → by_model[model] += tok
  └─ Codex : 取 turn_context 里(唯一/首个)model → by_model[model] = total_tokens(会话累计)
        │
        ▼
Session { ..., total_tokens, by_model: HashMap<String,u64> }   ← serde(default) 兼容旧缓存
        │  (scan_cache 序列化；sync.rs 不写此字段)
        ▼
前端 types/session.ts  Session.by_model?: Record<string, number>
        │
        ▼
aggregate.ts  aggregateUsage() 增产 byModel: ModelStat[]
        │      ModelStat { model, provider, sessions, tokens, cost }
        │      成本 = tokens/1e6 × modelRate(优先) ?? providerRate(回退)
        ▼
store/cost.ts  CostConfig 扩展 modelRates: {model→单价}(+内置默认表)
        ▼
usage.tsx  新增「按模型」区块：柱状图 + 列表(单价可编辑)
```

### 4.1 `by_model` 的 key 规范化

- 直接用文件里的原始模型串（`claude-opus-4-8` / `gpt-5.1-codex-max`）做 key，**不做映射归并**（KISS）。理由：映射表易过期、且用户可直接对原始名配单价。UI 层可做展示美化（可选，见 §7 D5）。
- 空 model（解析不到）归入 `"(unknown)"`，保证 `sum(by_model.values()) == total_tokens` 恒等（便于校验与前端回退）。

### 4.2 恒等式约束（关键正确性保证）

对每个 Session，必须满足 `Σ by_model.values() == total_tokens`。
- Codex：天然成立（整会话 token 归唯一模型）。
- Claude：若 `total_tokens` 与 `by_model` 用**同一套 token 口径**累加即成立（见 D4：是否纳入 cache tokens 必须两者一致，否则恒等式破裂）。
- 前端 `aggregate` 可选做一次断言/兜底：若某 Session 无 `by_model`（旧缓存），退化为 `{ providerFallbackModel: total_tokens }`，避免"按模型"总量对不上"总 token"。

---

## 5. 分阶段实现计划

> 标注 **[Rust 重建]** 的阶段改动 Rust，需 `cargo build`/重启 sidecar 生效。
> 每阶段可独立提交、独立验证。

### 阶段 0 · 决策冻结（无代码）
- 通过 §7 决策点逐项定稿（尤其 D1 是否拆 input/output、D3 缓存迁移、D4 cache tokens）。
- 产出：在本文件勾选决策结论。
- 验证：评审通过。

### 阶段 1 · Rust 解析层产出 `by_model` **[Rust 重建]**
改动文件：
- `src-tauri/src/models.rs`：`Session` 新增
  `#[serde(default)] pub by_model: std::collections::HashMap<String, u64>,`
  （`#[serde(default)]` 让旧缓存缺字段时反序列化为空 map，不报错）。
- `src-tauri/src/providers/claude.rs::parse_session_file`：
  - 在解析 assistant `usage` 时，同时取 `/message/model`（缺失→`"(unknown)"`），把该条 token 累加进局部 `by_model` map；`total_tokens` 与 `by_model` 用**同一 token 口径**（D4 定）。
- `src-tauri/src/providers/codex.rs::scan_codex_session`：
  - 新增：解析 `turn_context.payload.model`，记录会话模型（首个非空；若出现多个则记录全部到一个 `Vec`/`Set`，见 D2）。
  - 收尾：`by_model[model] = total_tokens`（一会话一模型近似）；无 model→`"(unknown)"`。
- 构造 `Session { ... }` 处补 `by_model` 字段（两个 provider + `scan_cache.rs` 测试 `mk()` + `sync.rs` 测试 `make_session()` 若编译需要则补默认 `HashMap::new()`）。

要点：
- `by_model` 用 `HashMap<String,u64>`；serde 默认序列化为 JSON 对象，前端可直接消费。
- Codex 多 model 情形（D2）：MVP 可只取首个 model 承载全部 token（够用），或按 turn_context 出现次数均摊（过度设计，不建议）。

验证：
- 新增/更新单测：claude fixture 增加带 `model` 的 assistant 行，断言 `by_model` 含该模型且 `Σ==total_tokens`；codex fixture 增加 `turn_context` 行，断言 `by_model[model]==total_tokens`。
- `cargo test -p <crate>` 通过；手动重启后前端能收到带 `by_model` 的会话。

### 阶段 2 · 缓存版本与兼容 **[Rust 重建]**
改动文件：
- `src-tauri/src/scan_cache.rs`：把 `CACHE_VERSION` 从 `1` → `2`。
要点/决策依赖 D3：
- **方案 A（推荐，KISS）**：仅 bump `CACHE_VERSION=2`。旧缓存整体失效→首启一次全量扫描重建（含 `by_model`）。代价：用户首次启动慢一次；收益：数据立刻完整、无半空 `by_model`。
- **方案 B**：不 bump 版本，靠 `#[serde(default)]` 让旧缓存加载成功但 `by_model` 为空，等各会话文件下次变动才增量补全。代价：存量会话长期缺 `by_model`，"按模型"视图长期不准，直到文件被改动。
- 结论建议采用 A（bump=2），配合阶段 1 的 `#[serde(default)]` 双保险（default 防止未来再加字段时崩溃）。

验证：`scan_cache` 单测 `save_load_roundtrip_and_version` 更新期望版本号；手动删除/保留旧 `scan_cache.json` 观察重建。

### 阶段 3 · 前端类型同步
改动文件：
- `src/types/session.ts`：`Session` 新增 `by_model?: Record<string, number>;`（可选，兼容旧数据/未解析场景）。
验证：`tsc` 通过。

### 阶段 4 · aggregate 增加 `byModel` 维度
改动文件：
- `src/features/usage/aggregate.ts`：
  - 新增 `interface ModelStat { model: string; provider: string; sessions: number; tokens: number; cost: number; }`
  - `UsageSummary` 增 `byModel: ModelStat[]`。
  - `aggregateUsage(sessions, rates, days, modelRates?)`：遍历每个 session 的 `by_model`（缺失则回退 `{fallbackModel: total_tokens}`，fallback 用 provider 名或 `provider+":unknown"`）；按 `model` 聚合；单价优先 `modelRates[model]`，回退 `rates[provider]`，再回退 0。
  - `sessions` 计数：同一会话可能贡献多个模型，`ModelStat.sessions` 语义定为"涉及该模型的会话数"（去重计数）。
要点：保持纯函数、无副作用；`byModel` 按 tokens 降序。
验证：`aggregate.test.ts` 增用例——含 `by_model` 的会话拆出多模型；断言各模型 tokens/cost、恒等式 `Σ byModel.tokens == totalTokens`；缺 `by_model` 时回退不丢 token。

### 阶段 5 · 单价配置扩展到按模型
改动文件：
- `src/store/cost.ts`：
  - `CostConfig` 增 `modelRates: Record<string, number>`。
  - `DEFAULT_COST_CONFIG` 视 D6 决定是否内置主流模型单价表（如 `claude-opus-*`, `claude-sonnet-*`, `gpt-5.1-*` 等）。
  - 新增 `setModelRate(model, rate)`；`load()` 合并默认 `modelRates`。
要点：localStorage 结构向后兼容（`modelRates` 缺失→取默认）。
验证：手动改单价刷新后持久化；`load` 合并逻辑单测（若为该 store 补测）。

### 阶段 6 · UI「按模型」区块
改动文件：
- `src/pages/usage.tsx`：
  - 新增一个 `<section>`「按模型」，复用现有 `BarChart`（`dataKey="tokens"`, `XAxis dataKey="model"`）+ 下方列表（模型名 / tokens / 成本 / 可编辑单价，参照现有"按 Provider"块）。
  - 顶部说明文案更新（如把"暂无 input/output 拆分"按 D1/D4 结论修正）。
  - 单价输入绑定 `config.modelRates[model]` + `setModelRate`。
验证：手动跑起来看 opus/sonnet 分列、单价可改、成本随之变化；空数据兜底文案正常。

### 阶段 7 · 回归与文档
- 跑 `cargo test` + `vitest`；手动完整点一遍成本塔三/四个维度。
- 更新 `2026-07-16-usage-cost-tower.md` 补一句"已加按模型维度"或交叉引用本文件。

---

## 6. 涉及文件清单（速查）

| 层 | 文件 | 改动 | Rust 重建 |
|----|------|------|:--:|
| 模型 | `src-tauri/src/models.rs` | `Session.by_model` + `#[serde(default)]` | ✅ |
| 解析 | `src-tauri/src/providers/claude.rs` | 按 `/message/model` 累加 by_model | ✅ |
| 解析 | `src-tauri/src/providers/codex.rs` | 取 `turn_context.model`，整会话归一模型 | ✅ |
| 缓存 | `src-tauri/src/scan_cache.rs` | `CACHE_VERSION 1→2`；测试 `mk()` 补字段 | ✅ |
| 同步 | `src-tauri/src/sync.rs` | 仅测试 `make_session()` 可能需补字段（业务不变） | ✅ |
| 类型 | `src/types/session.ts` | `by_model?` | — |
| 聚合 | `src/features/usage/aggregate.ts` | `ModelStat` + `byModel` | — |
| 聚合测试 | `src/features/usage/aggregate.test.ts` | 新增用例 | — |
| 单价 | `src/store/cost.ts` | `modelRates` + `setModelRate`(+默认表) | — |
| UI | `src/pages/usage.tsx` | 「按模型」区块 | — |

---

## 7. 决策点（需评审拍板）

**D1 · 是否拆 input/output token？**
- 现状：`total_tokens = input + output` 合并。
- 拆分价值：input/output 单价不同（output 通常贵 3–5 倍），拆开才能精算成本。
- 成本：`by_model` 值从 `u64` 变结构体（`{in,out}`），前端聚合/UI 复杂度上升。
- 推荐：**本期不拆**（YAGNI）。`by_model` 先只存合并 token；单价用"混合等效单价"。若后续要精算，再升 `by_model` 为结构体（届时 bump 缓存版本）。
- ⛳ 结论：______

**D2 · Codex 多模型会话如何处理？**
- 实证：最近 30 会话 0 个多模型。
- 推荐：**取首个非空 `turn_context.model`，整会话 token 归它**（KISS）。若真出现多模型，记录到 `"(mixed)"` 或首模型均可，不精细拆。
- ⛳ 结论：______

**D3 · 旧 scan_cache 迁移策略？**
- 方案 A（推荐）：bump `CACHE_VERSION=2`，旧缓存失效→一次全量重建，`by_model` 立即完整。
- 方案 B：仅靠 `#[serde(default)]`，存量会话 `by_model` 空，逐步补全（数据长期不准）。
- 推荐：**A + `#[serde(default)]` 双保险**。
- ⛳ 结论：______

**D4 · Claude 是否纳入 cache tokens？（含总量口径一致性）**
- 实证：`usage` 含 `cache_creation_input_tokens`/`cache_read_input_tokens`，量级远超 `input_tokens`；当前 `total_tokens` 忽略它们 → **成本严重低估**。
- 关键约束：无论选什么口径，`total_tokens` 与 `by_model` 累加必须用**同一口径**，否则恒等式破裂。
- 选项：
  - (a) 维持现状（只 input+output）——低估但改动最小、口径一致。
  - (b) 纳入 cache（更接近真实计费；但 cache_read 计费单价与普通 input 不同，精算需再拆）——更准但更复杂。
- 推荐：**本期先 (a) 保持一致口径**，在 UI 文案标注"未含缓存 token"；把 (b) 作为独立后续项（连同 D1 的 input/output 拆分一起做）。
- ⛳ 结论：______

**D5 · 模型名是否做展示美化/归并？**
- 原始名 `claude-opus-4-8` / `gpt-5.1-codex-max` 直接展示 vs 映射为 `Opus 4.8` 等。
- 推荐：**存储用原始名（不归并）**；UI 可加一个纯展示层的美化函数（可选，非阻塞）。
- ⛳ 结论：______

**D6 · 是否内置主流模型单价表？**
- 选项：(a) 内置默认 `modelRates`（opus/sonnet/haiku/gpt-5.1 等常见档），用户开箱即用；(b) 全手填。
- 权衡：内置提升 UX，但单价会过期、且币种/折扣因人而异 → 维护负担。
- 推荐：**内置一份"占位默认表"**（像现有 provider 默认那样，标注为估算值、可改），未知模型回退 provider 单价再回退 0。
- ⛳ 结论：______

---

## 8. 风险与回滚

- 风险：阶段 1 忘记在某个 `Session {}` 构造处补 `by_model` → 编译失败（`#[serde(default)]` 只影响反序列化，不影响构造）。缓解：全仓搜 `Session {` 逐处补。
- 风险：恒等式 `Σ by_model == total_tokens` 被破坏（尤其 D4 口径不一致）→ "按模型"总量与"总 token"卡片对不上。缓解：解析层同源累加 + `aggregate` 层兜底回退 + 单测断言恒等式。
- 回滚：前端各阶段独立，可单独 revert UI/aggregate 而保留 Rust 字段（字段存在不影响旧 UI）。Rust 侧回滚需同时回退 `CACHE_VERSION`。
```
