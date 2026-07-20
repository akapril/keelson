# rework 五大功能 ROADMAP（2026-07-20）

> 本轮规划把「都做」的 5 个 M+ 功能各出了一份设计+计划文档。本 ROADMAP 汇总**建议顺序、依赖、优先级、必须拍板的决策**。逐个执行前，先确认本页的顺序与决策。

## 五个功能一览

| # | 功能 | 规模 | 依赖 | 计划文档 |
|---|---|---|---|---|
| 1 | **RAG 真语义** | S(主线A) / M(含B) | 无（是 #4 的地基） | `2026-07-20-rag-real-semantic.md` |
| 2 | **成本塔按模型** | M | 无 | `2026-07-20-cost-by-model.md` |
| 3 | **溯源 Phase 2**（git 钩子打 trailer） | M | Phase 1(已完成) | `2026-07-20-provenance-phase2.md` |
| 4 | **跨厂商记忆账本** | L | RAG(语义去重/检索，MVP 可先关键词) | `2026-07-20-cross-vendor-memory-ledger.md` |
| 5 | **Loop 收件箱** | L | 无（MVP 复用现有通知） | `2026-07-20-loop-inbox.md` |

## 建议执行顺序（价值×成本×依赖）

1. **RAG 真语义（主线 A）** — 最小、纯前端、复用已配的 OpenAI key 即刻可用；**是记忆账本的地基**，且修「问历史」核心功能名不副实。**先做**。
2. **成本塔按模型** — M、独立、地基现成；顺带修 Claude cache-token 低估(见下)。
3. **溯源 Phase 2** — M、独立、闭合已建的溯源链另一半。
4. **Loop 收件箱（MVP）** — 复用现有 4 类通知聚成 `/inbox` + 批处理，先证明价值；新事件源/Codex 事件面留 Phase 2。
5. **跨厂商记忆账本** — 护城河最硬但最大、决策最多；放最后，且 RAG 真语义就绪后语义去重/检索更好。MVP 可先关键词、不被 RAG 阻塞。

> 也可把 #4 Loop 与 #5 记忆并行推（互不依赖），但都 L、决策多，建议串行以便你逐个把关。

## ⚠️ 顺带发现（需拍板的顺修项）
- **Claude 成本被系统性低估**：解析层 `total_tokens` 只累加 `input_tokens+output_tokens`，**忽略 `cache_creation_input_tokens`/`cache_read_input_tokens`**（实证一条样本 input=2 但 cache_creation=18273）。这让成本塔的数字偏低很多。建议在 #2 一并按同口径精算（cache token 单价不同，需分列）。详见 cost-by-model 计划 D4。

## 必须你拍板的关键决策（跨功能汇总）

**RAG（#1）**
- D-RAG-1【最重】**local-embed 是否默认编入构建**？(离线语义/数据不出本机，代价 二进制膨胀 + 首次 ~90MB 下载)。推荐**否**（主线 A 已够用），B 作可选 feature。
- D-RAG-2 主线 A（复用 AI 的 OpenAI key 做 embeddings）是否 P0 立即做？推荐**是**。
- D-RAG-3 复用 key：一键手动 vs 自动同步？推荐一键手动。

**成本按模型（#2）**
- D-COST-1 是否拆 input/output token？推荐本期不拆(YAGNI)。
- D-COST-2 旧缓存迁移：bump CACHE_VERSION 全量重建 + serde default。推荐。
- D-COST-3 是否内置主流模型单价表？推荐内置占位默认表 + 回退 provider 单价。
- D-COST-4【顺修】是否本期一并修 cache-token 低估？(见上)

**溯源 Phase 2（#3）**
- D-PROV-1 marker 载体：每仓库 `.git/rework-session`（钩子零依赖 cat）vs 集中 json。推荐前者。
- D-PROV-2 遇第三方 prepare-commit-msg：追加标记块共存(推荐) vs 拒绝安装。

**记忆账本（#4）**
- D-MEM-1【最重】注入方式：先 Pull/MCP(`search_memory` 让 CLI 主动查)、后 Write(受管块写 CLAUDE.md/AGENTS.md)。认可否？
- D-MEM-2 记忆粒度：4 类 kind + 2 类 scope。够否？
- D-MEM-3 MVP 去重先字符级(漏语义重复)、语义去重后置。接受否？
- D-MEM-4 MVP 检索走关键词、不等向量库。认可否？

**Loop 收件箱（#5）**
- D-LOOP-1 agent 完成事件走 MCP 上报 + 各家 hook 转发（非轮询）。认可否？
- D-LOOP-2 扩现有 `notifications` 集合(加 status/group_key/dedupe_key) vs 新建。推荐扩。
- D-LOOP-3 UI：铃铛快览 + `/inbox` 独立页 双层 vs 只扩铃铛。

## 每个功能的执行方式
- 每个功能各自 spec/计划齐备后，走**子代理驱动**逐任务实现 + 广审 + 合并（与本 session 一致）。
- 纯前端项(RAG 主线 A、Loop 前端、记忆前端)重建甚至热更新即可测；含 Rust 的(成本解析、溯源钩子、MCP 工具、local-embed)需 `cargo build`。

---

**下一步**：确认①执行顺序②上面各 D-* 决策（尤其 D-RAG-1、D-MEM-1、D-COST-4）。确认后我从 #1 RAG 真语义开始逐个实现。
