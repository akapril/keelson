# Agents 一等公民（S2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"派活选 CLI provider"升级为"派活选命名队友（小K/小C…）"——队友封装 provider + 默认指令 + 绑技能 + 运行时偏好 + 名/头像，worker 执行时注入这些属性。

**Architecture:** 新增 `agent_profiles` 集合 + `board_tasks.agent_id` + `agent_runs.agent`。executor `execute_task_with_agent` 从收 `provider` 改为收 `agent_ref`（agent_id 优先解析，查不到回退当 provider）；`resolve_agent` 产出 `ResolvedAgent`，注入 prompt（instructions+技能）与运行时（with_tools/timeout/auto_commit）。worker 按 agent 的 `max_concurrent` 分组计并发（全局 `AGENT_CONCURRENCY` 退兜底）。默认队友的 seed + 现有任务回填放 **Rust bootstrap**（幂等 ensure，因迁移期 local-user 尚不存在）。前端加 Agents 管理页 + 侧栏入口，TaskCard 指派改列队友。

**Tech Stack:** Rust / Tauri v2、tokio、PocketBase（JS 迁移 + REST `PbClient`）、React 19 + TypeScript、zustand、react-i18next、react-router、vitest。

设计依据：`docs/superpowers/specs/2026-08-17-agents-first-class-s2-design.md`（已过审）。

## Global Constraints

- **复用 S1 内核不重写**：executor/worktree/worker/AgentRunPanel/agent-runs/prompts 库全复用。
- **S1 兼容**：`agent_id` 为空一律回退 `agent_provider`（S1 直跑入口 `agent_run_task`、旧数据、回退归组都不破）。
- **execute_task_with_agent 三个调用点必须同步改到 `agent_ref` 语义**：定义 `executor.rs`、`worker.rs` poll_once、`commands/agent.rs` `agent_run_task`。任一漏改 → 编译失败。
- **安全**：worker 绝不自动合并主干；`auto_commit=true` 仅在**隔离 worktree 内** `git commit`，不 push、不 merge。
- **中文注释**；**不硬编码**（全局兜底/默认值用常量：`AGENT_CONCURRENCY`/`AGENT_TIMEOUT_SECS`/`DEFAULT_MAX_CONCURRENT`）。
- **store 写失败重抛 + toast**（沿用 board store `updateTask` 范式）。
- **子进程走 `crate::proc::hidden_*`**（`build_process` 已含 `kill_on_drop(true)`，勿绕过）。
- **迁移范式**：软删 `deleted_at`、`text max:0` 绕 PB 5000 上限（instructions/skill_text）、relation 用 `collectionId`、`addIndex`、down 删集合+移字段。默认队友 seed/回填**不放 JS 迁移**（迁移期无 local-user），放 Rust bootstrap 幂等 ensure。
- **TDD**：纯函数（`build_task_prompt` 注入、`pick_eligible` 按 agent 分组、`taskHasAgent`）先写失败测试。Rust 集成靠 `cargo check` + CI；**Windows 本地 `cargo test` 报 0xc0000139（Tauri GUI DLL），只验编译**，断言走 CI。
- **tsc 通过**（`pnpm tsc --noEmit`）。
- **提交不加 `Co-Authored-By: Claude` 尾注**。
- **git add 精确文件，严禁 `git add -A`/`git add .`**（工作区有未跟踪 spec/plan + 私有 `docs/promotion/`）。

---

## File Structure

- `src-tauri/pb_migrations/1786400000_agent_profiles.js`（新）：建 `agent_profiles` 集合 + `board_tasks.agent_id` + `agent_runs.agent`。**仅建结构，无 seed/回填**。
- `src-tauri/src/agent/ensure.rs`（新）：`ensure_default_agents(client, owner_id)`（幂等 seed 两默认队友 + 首次回填现有 agent_provider→agent_id）。
- `src-tauri/src/agent/mod.rs`（改）：`pub mod ensure;`。
- `src-tauri/src/lib.rs`（改）：`setup_pocketbase` auth 就绪后、启动 worker 前调 `ensure_default_agents`。
- `src-tauri/src/agent/resolve.rs`（新）：`ResolvedAgent` 结构 + `resolve_agent(client, agent_ref)`。
- `src-tauri/src/agent/executor.rs`（改）：签名 `provider`→`agent_ref`；用 `resolve_agent`；prompt/runtime 注入；run 写 `provider`(解析值)+`agent`(agent_id)。
- `src-tauri/src/agent/prompt.rs`（改）：`build_task_prompt` 增参注入 instructions+skills+skill_text（纯函数 + 测）。
- `src-tauri/src/agent/worker.rs`（改）：候选查询、拉 agent_profiles 并发上限、`pick_eligible` 按 agent 分组（纯函数 + 测）、`EnqueuedTask` 加 agent 维度、execute 调用传 agent_ref。
- `src-tauri/src/commands/agent.rs`（改）：`agent_run_task` 参数 `provider`→`agent_ref`；`list_agent_runs` fields 补 `agent`。
- `src/types/agent-profile.ts`（新）：`AgentProfile` 类型。
- `src/lib/pb/agents.ts`（新）：list/create/update/softDelete。
- `src/store/agents.ts`（新）：zustand（乐观更新写失败重抛+toast）。
- `src/pages/agents.tsx`（新）+ `src/features/agents/*`（卡片/编辑表单）：Agents 管理页。
- `src/router.tsx`（改）：`/agents` lazy 路由。
- `src/lib/navigation.ts`（改）：加「Agents」入口。
- `src/features/board/TaskCard.tsx`（改）：指派列队友、写 `agent_id`、徽标显 emoji+名。
- `src/features/board/agent-filter.ts`（改）：`taskHasAgent` 增 `agent_id` 判据。
- `src/features/board/AgentRunPanel.tsx`（改）：顶部显执行队友。
- `src/types/board.ts`（改）：`BoardTask` 加 `agent_id?`。
- `src/types/agent.ts`（改）：`AgentRun` 加 `agent?`。
- `src/i18n/locales/{zh,en}/board.json`、`src/i18n/locales/{zh,en}/shell.json`（改）：Agents 文案 + nav 键。

---

## Task 1: 迁移 —— agent_profiles 集合 + board_tasks.agent_id + agent_runs.agent

只建结构，不 seed/回填（seed 见 Task 2）。

**Files:**
- Create: `src-tauri/pb_migrations/1786400000_agent_profiles.js`

**Interfaces:**
- Produces（PB 集合/字段，供后续任务读写）：
  - `agent_profiles`：owner(rel users)/name/emoji/color/provider/instructions(max0)/skill_prompts(rel prompts, maxSelect20)/skill_text(max0)/timeout_secs(num)/max_concurrent(num)/with_tools(bool)/auto_commit(bool)/archived(bool)/deleted_at(date)/created/updated。
  - `board_tasks.agent_id`(text,max200)、`agent_runs.agent`(text,max200)。

- [ ] **Step 1: 写迁移文件**

创建 `src-tauri/pb_migrations/1786400000_agent_profiles.js`：

```js
// S2 Agents 一等公民：新集合 agent_profiles（命名队友）；board_tasks 加 agent_id；agent_runs 加 agent。
// 注意：默认队友 seed + 现有任务回填 NOT 放这里 —— 迁移(automigrate)在 bootstrap 建 local-user 之前运行，
//       此刻无 owner 可引用；且默认队友需可被用户编辑(owner=""会因 updateRule 只读)。故 seed/回填放 Rust bootstrap。
// instructions/skill_text 用 max:0 绕开 PB 运行时 5000 字符上限。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const prompts = app.findCollectionByNameOrId("prompts");
  const auto = (name, onUpdate) =>
    new Field({ name, type: "autodate", onCreate: true, onUpdate: !!onUpdate });

  // 1) agent_profiles 集合（owner-only；沿用 prompts/agent_runs 的访问规则范式）
  const c = new Collection({
    name: "agent_profiles",
    type: "base",
    listRule: `@request.auth.id != "" && owner = @request.auth.id`,
    viewRule: `@request.auth.id != "" && owner = @request.auth.id`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    updateRule: `owner = @request.auth.id`,
    deleteRule: `owner = @request.auth.id`,
  });
  c.fields.add(new Field({ name: "owner", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 }));
  c.fields.add(new Field({ name: "name", type: "text", required: true, max: 100 }));
  c.fields.add(new Field({ name: "emoji", type: "text", max: 16 }));
  c.fields.add(new Field({ name: "color", type: "text", max: 40 }));
  c.fields.add(new Field({ name: "provider", type: "text", required: true, max: 40 }));
  c.fields.add(new Field({ name: "instructions", type: "text", max: 0 }));
  c.fields.add(new Field({ name: "skill_prompts", type: "relation", required: false, collectionId: prompts.id, cascadeDelete: false, maxSelect: 20 }));
  c.fields.add(new Field({ name: "skill_text", type: "text", max: 0 }));
  c.fields.add(new Field({ name: "timeout_secs", type: "number" }));
  c.fields.add(new Field({ name: "max_concurrent", type: "number" }));
  c.fields.add(new Field({ name: "with_tools", type: "bool", required: false }));
  c.fields.add(new Field({ name: "auto_commit", type: "bool", required: false }));
  c.fields.add(new Field({ name: "archived", type: "bool", required: false }));
  c.fields.add(new Field({ name: "deleted_at", type: "date" }));
  c.fields.add(auto("created", false));
  c.fields.add(auto("updated", true));
  c.addIndex("idx_agent_profiles_owner", false, "owner, updated", "");
  app.save(c);

  // 2) board_tasks 加 agent_id（text 而非 relation：队友软删后任务侧仍留 id 做回退判断）
  const tasks = app.findCollectionByNameOrId("board_tasks");
  if (!tasks.fields.getByName("agent_id")) {
    tasks.fields.add(new Field({ name: "agent_id", type: "text", max: 200 }));
  }
  app.save(tasks);

  // 3) agent_runs 加 agent（派活时的 agent id，溯源；run 仍保留已解析 provider 不变）
  const runs = app.findCollectionByNameOrId("agent_runs");
  if (!runs.fields.getByName("agent")) {
    runs.fields.add(new Field({ name: "agent", type: "text", max: 200 }));
  }
  app.save(runs);
}, (app) => {
  // down：删 agent_profiles 集合 + 移除 board_tasks.agent_id / agent_runs.agent
  try {
    app.delete(app.findCollectionByNameOrId("agent_profiles"));
  } catch (_) {}
  try {
    const tasks = app.findCollectionByNameOrId("board_tasks");
    const f = tasks.fields.getByName("agent_id");
    if (f) tasks.fields.removeById(f.id);
    app.save(tasks);
  } catch (_) {}
  try {
    const runs = app.findCollectionByNameOrId("agent_runs");
    const f = runs.fields.getByName("agent");
    if (f) runs.fields.removeById(f.id);
    app.save(runs);
  } catch (_) {}
});
```

- [ ] **Step 2: 验证迁移文件语法**

Run: `node --check src-tauri/pb_migrations/1786400000_agent_profiles.js`
Expected: 无输出（语法正确）。运行时由 PB automigrate 应用（应用启动时），本步仅静态查语法。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/pb_migrations/1786400000_agent_profiles.js
git commit -m "feat(agent): 迁移 agent_profiles 集合 + board_tasks.agent_id + agent_runs.agent(S2)"
```

---

## Task 2: Rust —— ensure_default_agents（幂等 seed + 首次回填）+ bootstrap wiring

迁移只建结构；默认队友与回填放 Rust bootstrap（auth 就绪、local-user 已建之后），幂等。

**Files:**
- Create: `src-tauri/src/agent/ensure.rs`
- Modify: `src-tauri/src/agent/mod.rs`（加 `pub mod ensure;`）
- Modify: `src-tauri/src/lib.rs`（`setup_pocketbase` 内 auth 就绪后、`start_worker` 前调用）

**Interfaces:**
- Consumes: `crate::pb::client::PbClient`（`list`/`create`/`patch`，async，`anyhow::Result`）。
- Produces: `pub async fn ensure_default_agents(client: &PbClient, owner_id: &str)` —— 幂等：owner 已有任一 agent_profiles 则直接返回；否则建 Claude/Codex 两默认队友并回填 `board_tasks`（`agent_provider != "" && agent_id = ""` → 设对应默认队友 id）。

- [ ] **Step 1: 建模块声明**

在 `src-tauri/src/agent/mod.rs` 末尾加：

```rust
pub mod ensure;
```

- [ ] **Step 2: 实现 ensure.rs**

创建 `src-tauri/src/agent/ensure.rs`：

```rust
//! 默认队友的幂等预置 + 现有任务回填。
//! 放在 Rust bootstrap（非 JS 迁移）：迁移期 local-user 尚未创建，无 owner 可引用；
//! 且默认队友需可被用户编辑（owner="" 会因 updateRule 只读）。
use crate::pb::client::PbClient;
use serde_json::json;

/// 预置的默认队友定义：(name, emoji, color 键, provider)。
/// color 用 providers.ts 的色板键（前端据此取 chip/dot 类）。
const DEFAULT_AGENTS: &[(&str, &str, &str, &str)] = &[
    ("Claude", "🤖", "amber", "claude"),
    ("Codex",  "⚡", "sky",   "codex"),
];

/// 幂等预置默认队友 + 首次回填。owner 已有任一 agent_profiles → 直接返回（视为已初始化）。
pub async fn ensure_default_agents(client: &PbClient, owner_id: &str) {
    // 幂等守卫：查该 owner 是否已有 agent_profiles（含软删也算已初始化，避免重复播种）
    let filter = format!("owner = \"{}\"", owner_id.replace('"', ""));
    match client.list("agent_profiles", &filter, "id").await {
        Ok(rows) if !rows.is_empty() => return, // 已初始化
        Ok(_) => {}
        Err(e) => {
            eprintln!("[keelson] 查询 agent_profiles 失败（跳过预置，非致命）: {e}");
            return;
        }
    }

    // 建两个默认队友，记录 provider → 新建 id 映射，供回填
    let mut provider_to_id: Vec<(String, String)> = Vec::new();
    for (name, emoji, color, provider) in DEFAULT_AGENTS {
        let created = client
            .create("agent_profiles", &json!({
                "owner":       owner_id,
                "name":        name,
                "emoji":       emoji,
                "color":       color,
                "provider":    provider,
                "with_tools":  true,
                "auto_commit": false,
            }))
            .await;
        match created {
            Ok(rec) => {
                if let Some(id) = rec["id"].as_str() {
                    provider_to_id.push(((*provider).to_string(), id.to_string()));
                }
            }
            Err(e) => eprintln!("[keelson] 预置默认队友 {name} 失败（非致命）: {e}"),
        }
    }

    // 首次回填：现有 agent_provider 非空但 agent_id 空的任务 → 设为对应 provider 的默认队友 id
    let bf_filter = "agent_provider != \"\" && agent_id = \"\" && deleted_at = \"\"";
    let tasks = match client.list("board_tasks", bf_filter, "id,agent_provider").await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[keelson] 回填 agent_id 查询失败（非致命）: {e}");
            return;
        }
    };
    for t in tasks {
        let (Some(tid), Some(prov)) = (t["id"].as_str(), t["agent_provider"].as_str()) else { continue };
        if let Some((_, aid)) = provider_to_id.iter().find(|(p, _)| p == prov) {
            let _ = client
                .patch("board_tasks", tid, &json!({ "agent_id": aid }))
                .await;
        }
    }
}
```

- [ ] **Step 3: 在 lib.rs 接线**

在 `src-tauri/src/lib.rs` 的 `setup_pocketbase` 内，S1 已加的「启动 agent 队列 worker」块**之前**（即 `recover_interrupted_runs(&pb_client).await;` 之前）插入：

```rust
    // 预置默认队友 + 首次回填（幂等）：auth 已就绪、local-user 已建，此刻才可引用 owner。
    crate::agent::ensure::ensure_default_agents(&pb_client, &user_id).await;
```

> `pb_client` 与 `user_id`（`let user_id = auth.user_id.clone();`，约 679 行）在该处均在作用域内且未移动（实现前 `grep -n "pb_client\|user_id" src-tauri/src/lib.rs` 确认）。

- [ ] **Step 4: 编译验证**

Run: `cd src-tauri && cargo check`
Expected: 编译通过。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/agent/mod.rs src-tauri/src/agent/ensure.rs src-tauri/src/lib.rs
git commit -m "feat(agent): ensure_default_agents 幂等预置默认队友+回填(S2)"
```

---

## Task 3: Rust —— resolve_agent + prompt/runtime 注入（executor + prompt.rs）

executor 从收 `provider` 改为收 `agent_ref`（agent_id 优先，回退 provider）；解析队友并注入 prompt 与运行时。三个调用点同步改。

**Files:**
- Create: `src-tauri/src/agent/resolve.rs`
- Modify: `src-tauri/src/agent/mod.rs`（加 `pub mod resolve;`）
- Modify: `src-tauri/src/agent/prompt.rs`（`build_task_prompt` 增参 + 注入 + 测试）
- Modify: `src-tauri/src/agent/executor.rs`（签名 + resolve + 注入 + run 写 agent/provider）
- Modify: `src-tauri/src/agent/worker.rs`（execute 调用点传 agent_ref —— 仅这一处调用，pick_eligible 在 Task 4）
- Modify: `src-tauri/src/commands/agent.rs`（`agent_run_task` 参数 `provider`→`agent_ref`；`list_agent_runs` fields 补 `agent`）

**Interfaces:**
- Consumes: `PbClient`、`crate::agent::executor::agent_run_provider_id`、`build_task_prompt`（新签名）。
- Produces:
  - `pub struct ResolvedAgent { pub provider: String, pub instructions: String, pub skills: Vec<String>, pub skill_text: String, pub timeout_secs: Option<u64>, pub with_tools: bool, pub auto_commit: bool, pub agent_id: Option<String> }`
  - `pub async fn resolve_agent(client: &PbClient, agent_ref: &str) -> ResolvedAgent`
  - `build_task_prompt(title, description, project_name, task_id, agent_instructions: &str, skills: &[String], skill_text: &str) -> String`
  - `execute_task_with_agent(client, owner_id, task_id, agent_ref: &str, on_line) -> Result<String, String>`（`provider` 形参更名 `agent_ref`）

- [ ] **Step 1: 写 build_task_prompt 注入的失败测试**

在 `src-tauri/src/agent/prompt.rs` 的 `#[cfg(test)] mod tests` 内追加（新签名会先让现有测试编译失败——本步同时更新现有调用为新签名，见 Step 3）：

```rust
    #[test]
    fn injects_instructions_and_skills() {
        let p = build_task_prompt(
            "标题", "描述", "proj", "id1",
            "你是资深后端", &["技能A内容".into(), "技能B内容".into()], "自由文本技能",
        );
        assert!(p.contains("你是资深后端"));
        assert!(p.contains("技能A内容"));
        assert!(p.contains("技能B内容"));
        assert!(p.contains("自由文本技能"));
        // 原任务字段仍在
        assert!(p.contains("标题") && p.contains("描述") && p.contains("proj") && p.contains("id1"));
    }

    #[test]
    fn empty_agent_extras_omitted() {
        // 全空的队友附加信息：不应引入"队友指令"/"技能"段标题
        let p = build_task_prompt("t", "d", "proj", "id1", "", &[], "");
        assert!(!p.contains("# 队友指令"));
        assert!(!p.contains("# 技能"));
    }
```

- [ ] **Step 2: 运行测试确认失败（编译/断言）**

Run（Windows 本机验编译）: `cd src-tauri && cargo check`
Expected: 编译失败（`build_task_prompt` 参数数量不符）——预期，Step 3 补齐。

- [ ] **Step 3: 改 build_task_prompt 签名 + 注入**

替换 `src-tauri/src/agent/prompt.rs` 的 `build_task_prompt` 为：

```rust
/// 由任务字段 + 队友附加信息组出交给 CLI 的 prompt。
/// agent_instructions/skills/skill_text 均可空——空段省略，不引入空标题。
pub fn build_task_prompt(
    title: &str,
    description: &str,
    project_name: &str,
    task_id: &str,
    agent_instructions: &str,
    skills: &[String],
    skill_text: &str,
) -> String {
    let desc = if description.trim().is_empty() { "(无描述)" } else { description.trim() };

    // 队友指令段（非空才加，置于最前，定调身份/风格）
    let mut head = String::new();
    if !agent_instructions.trim().is_empty() {
        head.push_str(&format!("# 队友指令\n{}\n\n", agent_instructions.trim()));
    }

    // 技能/参考段（绑定 prompts 内容 + 自由文本，任一非空才加）
    let mut skill_block = String::new();
    let has_skills = skills.iter().any(|s| !s.trim().is_empty()) || !skill_text.trim().is_empty();
    if has_skills {
        skill_block.push_str("\n# 技能 / 参考\n");
        for s in skills {
            if !s.trim().is_empty() {
                skill_block.push_str(&format!("- {}\n", s.trim()));
            }
        }
        if !skill_text.trim().is_empty() {
            skill_block.push_str(&format!("{}\n", skill_text.trim()));
        }
    }

    format!(
        "{head}你是被指派到看板任务的编码助手，正在项目「{project_name}」的独立 git 工作树里工作。\n\n\
         # 任务\n标题：{title}\n描述：{desc}\n\n\
         # 要求\n\
         - 在当前工作目录直接完成此任务（改代码/加文件）。完成即停，不要开始新任务。\n\
         - 若被阻塞无法完成，用工具 update_task 说明 blocker，task_id = {task_id}。\n\
         - 不要执行 git commit/push，改动留在工作区即可（由人 review 后合并）。\n\
         {skill_block}",
        head = head, project_name = project_name.trim(), title = title.trim(),
        desc = desc, task_id = task_id, skill_block = skill_block,
    )
}
```

同时更新 `prompt.rs` 内**现有** 3 个测试对 `build_task_prompt` 的调用，补齐新参数（末尾加 `"", &[], ""`）：`includes_title_desc_project_taskid` / `empty_description_falls_back` / `instructs_no_commit` 三处调用改为如 `build_task_prompt("修登录 bug", "点击无反应", "keelson", "abc123", "", &[], "")`。

- [ ] **Step 4: 写 resolve.rs**

在 `src-tauri/src/agent/mod.rs` 加 `pub mod resolve;`。创建 `src-tauri/src/agent/resolve.rs`：

```rust
//! 把 agent_ref（agent_id 优先，回退当 provider）解析为执行所需的队友属性。
use crate::pb::client::PbClient;

/// 该 agent 未设 max_concurrent 时的默认并发（worker 用；此处仅解析用不到，留常量共享语义）。
pub const DEFAULT_MAX_CONCURRENT: u64 = 1;

/// 解析后的队友执行属性。
pub struct ResolvedAgent {
    pub provider: String,
    pub instructions: String,
    pub skills: Vec<String>,
    pub skill_text: String,
    pub timeout_secs: Option<u64>,
    pub with_tools: bool,
    pub auto_commit: bool,
    /// 命中队友时为 Some(agent_id)，回退 provider 时为 None（run.agent 据此写）。
    pub agent_id: Option<String>,
}

/// agent_ref 命中 agent_profiles.id → 取其属性；否则把 agent_ref 当原始 provider（S1 兼容），其余取默认。
pub async fn resolve_agent(client: &PbClient, agent_ref: &str) -> ResolvedAgent {
    let filter = format!("id = \"{}\"", agent_ref.replace('"', ""));
    let fields = "id,provider,instructions,skill_prompts,skill_text,timeout_secs,with_tools,auto_commit";
    let hit = client
        .list("agent_profiles", &filter, fields)
        .await
        .ok()
        .and_then(|rows| rows.into_iter().next());

    let Some(rec) = hit else {
        // 回退：agent_ref 当原始 provider（S1 直跑/旧数据）
        return ResolvedAgent {
            provider: agent_ref.to_string(),
            instructions: String::new(),
            skills: Vec::new(),
            skill_text: String::new(),
            timeout_secs: None,
            with_tools: true,
            auto_commit: false,
            agent_id: None,
        };
    };

    // 拉绑定技能内容（skill_prompts 是 prompt id 数组）→ 按序取 prompts.content
    let skill_ids: Vec<String> = rec["skill_prompts"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let mut skills = Vec::new();
    if !skill_ids.is_empty() {
        // 单次 OR 查询取内容；保持 skill_ids 顺序
        let or = skill_ids.iter()
            .map(|id| format!("id = \"{}\"", id.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" || ");
        if let Ok(rows) = client.list("prompts", &or, "id,content").await {
            for id in &skill_ids {
                if let Some(r) = rows.iter().find(|r| r["id"].as_str() == Some(id)) {
                    let c = r["content"].as_str().unwrap_or_default();
                    if !c.trim().is_empty() { skills.push(c.to_string()); }
                }
            }
        }
    }

    // number 字段：>0 才视为覆盖，否则用默认（None=全局超时；with_tools 缺省 true）
    let to = rec["timeout_secs"].as_f64().map(|n| n as u64).filter(|&n| n > 0);
    let with_tools = rec["with_tools"].as_bool().unwrap_or(true);
    let auto_commit = rec["auto_commit"].as_bool().unwrap_or(false);

    ResolvedAgent {
        provider: rec["provider"].as_str().unwrap_or_default().to_string(),
        instructions: rec["instructions"].as_str().unwrap_or_default().to_string(),
        skills,
        skill_text: rec["skill_text"].as_str().unwrap_or_default().to_string(),
        timeout_secs: to,
        with_tools,
        auto_commit,
        agent_id: Some(agent_ref.to_string()),
    }
}
```

- [ ] **Step 5: 改 executor 用 resolve + 注入 + run 写 agent/provider**

在 `src-tauri/src/agent/executor.rs` 的 `execute_task_with_agent`：

1. 形参 `provider: &str` 改名 `agent_ref: &str`（签名其余不变）。
2. 函数体开头（provider 支持校验之前）改为先解析队友：
   ```rust
   // 解析队友：agent_id 优先，回退把 agent_ref 当 provider（S1 兼容）
   let resolved = crate::agent::resolve::resolve_agent(client, agent_ref).await;
   let cli_provider = agent_run_provider_id(&resolved.provider)
       .ok_or_else(|| format!("P1 暂不支持 provider：{}（仅 claude/codex）", resolved.provider))?;
   ```
   （删去原来直接用 `provider` 的 `agent_run_provider_id(provider)` 那行。）
3. 建 running run 记录的 `json!` 里：`"provider": resolved.provider`（解析值），并加 `"agent": resolved.agent_id.clone().unwrap_or_default()`。
4. 组 prompt 改为带队友信息：
   ```rust
   let prompt = build_task_prompt(
       &title, &desc, &pname, task_id,
       &resolved.instructions, &resolved.skills, &resolved.skill_text,
   );
   ```
5. `run_cli_stream(cli_provider, None, Some(&wt_str), &msgs, resolved.with_tools, |piece| {...})`（`true` → `resolved.with_tools`）。
6. 超时用队友覆盖：
   ```rust
   let timeout = resolved.timeout_secs.unwrap_or(AGENT_TIMEOUT_SECS);
   let result = tokio::time::timeout(Duration::from_secs(timeout), run_fut).await;
   ```
7. 判定为 `Review` 且 `has_diff` 且 `resolved.auto_commit` 时，在 worktree 内 commit（不 push）。在写回 run 的 `Outcome::Review` 分支**之前**加：
   ```rust
   // 队友设了自动提交：在隔离 worktree 内 commit（绝不 push、不 merge；主干仍由人合并）
   if resolved.auto_commit && has_diff {
       if let Err(e) = crate::agent::worktree::commit_worktree(&wt, task_id) {
           eprintln!("[keelson] auto_commit 失败（非致命，改动仍在工作区）: {e}");
       }
   }
   ```

- [ ] **Step 6: 加 worktree::commit_worktree**

在 `src-tauri/src/agent/worktree.rs` 加（复用其内部 `git` 私有函数）：

```rust
/// auto_commit：在隔离 worktree 内把改动提交到 agent 分支（不 push、不 merge）。
/// 仅当队友 auto_commit=true 且有改动时由 executor 调用。
pub fn commit_worktree(worktree: &Path, task_id: &str) -> Result<()> {
    git(worktree, &["add", "-A"])?;
    // 有暂存内容才 commit（避免"无改动"报错）
    if git(worktree, &["diff", "--cached", "--quiet"]).is_err() {
        git(worktree, &["commit", "-m", &format!("agent: task {task_id}")])?;
    }
    Ok(())
}
```

- [ ] **Step 7: 改两个调用点传 agent_ref**

- `src-tauri/src/agent/worker.rs` 的 execute 调用（约 182 行）：把传入的 `&provider`/`&t.provider` 改为传该任务的 agent_ref（Task 4 会把 `EnqueuedTask` 的字段规整为 `agent_ref`；本任务先最小改动：worker 当前 `EnqueuedTask.provider` 存的是 `agent_provider`，暂时继续传它作为 agent_ref——resolve 会回退当 provider，行为不变，Task 4 再切到 agent_id 优先）。即：调用参数名从语义上视作 agent_ref，值暂用现有 provider 字段。**不改 worker 其他逻辑**。
- `src-tauri/src/commands/agent.rs` 的 `agent_run_task`：形参 `provider: String` 改名 `agent_ref: String`；`execute_task_with_agent(&client, &uid, &task_id, &agent_ref, ...)`。`list_agent_runs` 的 fields 串加 `agent`（`...provider,status,...` → `...provider,agent,status,...`）。

> ⚠ `agent_run_task` 是 Tauri 命令，参数名变化会影响前端 `ipc.agentRunTask` 的传参键（camelCase `agentRef`）。前端在 Task 7 同步；本任务只改 Rust，前端暂仍传 `provider` 键会导致该命令收到空 agent_ref——但「立即跑一次」是次要动作，Task 7 会修；`cargo check` 不受影响。

- [ ] **Step 8: 编译 + 说明**

Run: `cd src-tauri && cargo check`
Expected: 编译通过（prompt.rs 测试断言走 CI）。

- [ ] **Step 9: 提交**

```bash
git add src-tauri/src/agent/mod.rs src-tauri/src/agent/resolve.rs src-tauri/src/agent/prompt.rs src-tauri/src/agent/executor.rs src-tauri/src/agent/worktree.rs src-tauri/src/agent/worker.rs src-tauri/src/commands/agent.rs
git commit -m "feat(agent): resolve_agent + prompt/runtime 注入 + agent_ref 语义(S2)"
```

---

## Task 4: Rust —— worker 按 agent 并发（pick_eligible 分组）

worker 候选查询认 agent_id，拉各 agent 的 `max_concurrent`，`pick_eligible` 按 agent 分组计槽；全局 `AGENT_CONCURRENCY` 退兜底。

**Files:**
- Modify: `src-tauri/src/agent/worker.rs`

**Interfaces:**
- Consumes: `crate::agent::resolve::DEFAULT_MAX_CONCURRENT`、`crate::agent::executor::agent_run_provider_id`。
- Produces:
  - `EnqueuedTask { task_id: String, agent_ref: String, group_key: String, max_concurrent: u64 }`（替换旧 `{task_id, provider}`；`group_key`=agent_id 或回退 provider 名，`max_concurrent`=该 agent 上限或默认 1）。
  - `pick_eligible(candidates: &[EnqueuedTask], running_by_group: &HashMap<String,usize>, global_running: usize, global_cap: usize) -> Vec<EnqueuedTask>`（按 group 计槽 + 全局兜底）。

- [ ] **Step 1: 写 pick_eligible 分组的失败测试**

替换 `worker.rs` 内 `#[cfg(test)] mod tests` 的 pick_eligible 用例为按分组版（保留 EnqueuedTask 构造 helper 更新）：

```rust
    fn task(id: &str, group: &str, cap: u64) -> EnqueuedTask {
        EnqueuedTask { task_id: id.into(), agent_ref: "claude".into(), group_key: group.into(), max_concurrent: cap }
    }

    #[test]
    fn empty_candidates_yields_empty() {
        let running = std::collections::HashMap::new();
        assert!(pick_eligible(&[], &running, 0, 1).is_empty());
    }

    #[test]
    fn per_agent_cap_limits_same_group() {
        // 同一 agent(group=A) cap=1，两个候选 → 只派 1 个
        let running = std::collections::HashMap::new();
        let cands = vec![task("t1", "A", 1), task("t2", "A", 1)];
        let picked = pick_eligible(&cands, &running, 0, 8);
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].task_id, "t1");
    }

    #[test]
    fn different_agents_run_in_parallel() {
        // 两个不同 agent 各 cap=1，全局兜底 8 → 都派
        let running = std::collections::HashMap::new();
        let cands = vec![task("t1", "A", 1), task("t2", "B", 1)];
        let picked = pick_eligible(&cands, &running, 0, 8);
        assert_eq!(picked.len(), 2);
    }

    #[test]
    fn respects_existing_running_in_group() {
        // group A 已有 1 个在跑，cap=1 → 不再派 A；B 可派
        let mut running = std::collections::HashMap::new();
        running.insert("A".to_string(), 1usize);
        let cands = vec![task("t1", "A", 1), task("t2", "B", 1)];
        let picked = pick_eligible(&cands, &running, 1, 8);
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].group_key, "B");
    }

    #[test]
    fn global_cap_bounds_total() {
        // 全局兜底 1：即便两个不同 agent 也只派 1
        let running = std::collections::HashMap::new();
        let cands = vec![task("t1", "A", 5), task("t2", "B", 5)];
        let picked = pick_eligible(&cands, &running, 0, 1);
        assert_eq!(picked.len(), 1);
    }
```

- [ ] **Step 2: cargo check 确认失败**

Run: `cd src-tauri && cargo check`
Expected: 编译失败（EnqueuedTask 字段/pick_eligible 签名不符）——预期。

- [ ] **Step 3: 改 EnqueuedTask + pick_eligible**

替换 `worker.rs` 的结构与纯函数：

```rust
use std::collections::{HashMap, HashSet};

/// 一条候选入队任务（含分组维度，供按 agent 并发计算）。
#[derive(Clone, Debug, PartialEq)]
pub struct EnqueuedTask {
    pub task_id: String,
    /// 传给 executor 的 agent_ref（agent_id 优先，否则 provider）。
    pub agent_ref: String,
    /// 并发分组键：agent_id 非空则用之，否则用 provider 名（回退任务各自成组）。
    pub group_key: String,
    /// 该组并发上限（agent 的 max_concurrent，或默认 1）。
    pub max_concurrent: u64,
}

/// 按 agent 分组计槽挑本轮可派任务：
/// - 每个 group 已跑数（running_by_group）+ 本轮已挑数 < 该 group 的 max_concurrent；
/// - 且总数（global_running + 本轮已挑）< global_cap（兜底防失控）；
/// 保持输入顺序。
pub fn pick_eligible(
    candidates: &[EnqueuedTask],
    running_by_group: &HashMap<String, usize>,
    global_running: usize,
    global_cap: usize,
) -> Vec<EnqueuedTask> {
    let mut out: Vec<EnqueuedTask> = Vec::new();
    // 本轮各组已挑计数（叠加到 running_by_group 之上）
    let mut picked_by_group: HashMap<String, usize> = HashMap::new();
    for t in candidates {
        // 全局兜底
        if global_running + out.len() >= global_cap {
            break;
        }
        let already = running_by_group.get(&t.group_key).copied().unwrap_or(0)
            + picked_by_group.get(&t.group_key).copied().unwrap_or(0);
        let cap = if t.max_concurrent == 0 { crate::agent::resolve::DEFAULT_MAX_CONCURRENT } else { t.max_concurrent };
        if (already as u64) >= cap {
            continue;
        }
        *picked_by_group.entry(t.group_key.clone()).or_insert(0) += 1;
        out.push(t.clone());
    }
    out
}
```

- [ ] **Step 4: 改 poll_once 组装候选 + running 分组**

改 `worker.rs` `poll_once`：

1. 候选查询：`"agent_enqueued = true && agent_provider != \"\" && deleted_at = \"\""` → `"agent_enqueued = true && (agent_id != \"\" || agent_provider != \"\") && deleted_at = \"\""`；fields `"id,agent_id,agent_provider"`。
2. 先拉活跃 agent_profiles 的 `id→max_concurrent` 映射：
   ```rust
   let profiles = client.list("agent_profiles", "deleted_at = \"\"", "id,max_concurrent").await
       .map_err(|e| e.to_string())?;
   let cap_of: HashMap<String, u64> = profiles.into_iter().filter_map(|p| {
       let id = p["id"].as_str()?.to_string();
       let cap = p["max_concurrent"].as_f64().map(|n| n as u64).filter(|&n| n > 0)
           .unwrap_or(crate::agent::resolve::DEFAULT_MAX_CONCURRENT);
       Some((id, cap))
   }).collect();
   ```
3. 组装候选：每行取 `agent_id`（非空）否则 `agent_provider` 作 `agent_ref`；`group_key` = agent_id 非空则 agent_id，否则 `provider:<provider>`（伪组）；`max_concurrent` = agent_id 命中 cap_of 则用之，否则默认 1。
   ```rust
   let candidates: Vec<EnqueuedTask> = cand_rows.into_iter().filter_map(|r| {
       let id = r["id"].as_str()?.to_string();
       let aid = r["agent_id"].as_str().unwrap_or_default().to_string();
       let prov = r["agent_provider"].as_str().unwrap_or_default().to_string();
       let (agent_ref, group_key, cap) = if !aid.is_empty() {
           let cap = cap_of.get(&aid).copied().unwrap_or(crate::agent::resolve::DEFAULT_MAX_CONCURRENT);
           (aid.clone(), aid, cap)
       } else {
           (prov.clone(), format!("provider:{prov}"), crate::agent::resolve::DEFAULT_MAX_CONCURRENT)
       };
       Some(EnqueuedTask { task_id: id, agent_ref, group_key, max_concurrent: cap })
   }).collect();
   ```
4. running 分组：S1 已按 `(running||review||blocked)` 拉 runs（含 `task,status,agent`——`agent` 字段 Task 1 已加，查询 fields 改 `"id,task,status,agent"`）。构造 `running_by_group: HashMap<String,usize>`（status==running 的按其 group 计数——group 用 run.agent 非空则 agent，否则据该 task 的 provider；MVP 简化：running run 的 group 用 `agent` 非空则 `agent`，否则 `provider:<run.provider>`），`global_running` = running 状态计数；`busy_ids`（非终态 task 集，S1 逻辑保留，先从候选剔除）。
   > 说明：busy 剔除（S1 防自动重派）在分组计槽**之前**执行——先 `candidates.retain(|c| !busy_ids.contains(&c.task_id))`，再 `pick_eligible`。
5. `let picked = pick_eligible(&candidates, &running_by_group, global_running, AGENT_CONCURRENCY_GLOBAL_CAP);`——其中全局兜底常量：把 S1 的 `AGENT_CONCURRENCY`（=1）语义提升为"总闸"，本任务将其重命名/新增 `pub const AGENT_CONCURRENCY_GLOBAL_CAP: usize = 8;`（兜底放宽到 8，真正限流靠 per-agent；保留旧 `AGENT_CONCURRENCY` 常量供不破坏 S1 引用，或改所有引用——实现时 `grep -n AGENT_CONCURRENCY src-tauri/src` 全改）。
6. 派发循环：清 `agent_enqueued` + 后台 spawn `execute_task_with_agent(&client2, &owner2, &task_id, &agent_ref, ...)`（传 `t.agent_ref`）；emit 不变。

- [ ] **Step 5: cargo check 通过**

Run: `cd src-tauri && cargo check`
Expected: 编译通过（pick_eligible 断言走 CI）。实现后 `grep -n "AGENT_CONCURRENCY" src-tauri/src` 确认无悬挂旧引用。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/agent/worker.rs
git commit -m "feat(agent): worker 按 agent 并发分组 + 候选认 agent_id(S2)"
```

---

## Task 5: 前端数据层 —— 类型 + PB 访问 + store

**Files:**
- Create: `src/types/agent-profile.ts`
- Create: `src/lib/pb/agents.ts`
- Create: `src/store/agents.ts`
- Modify: `src/types/board.ts`（`BoardTask` 加 `agent_id?`）
- Modify: `src/types/agent.ts`（`AgentRun` 加 `agent?`）

**Interfaces:**
- Consumes: `pb`（`src/lib/pb`）、`softDeleteRecord`/`NOT_DELETED`（`src/lib/pb/collections`）、`currentUserId`。
- Produces:
  - `AgentProfile` 接口（下）。
  - `listAgents()/createAgentRecord(data)/updateAgentRecord(id,data)/softDeleteAgent(id)`。
  - `useAgentStore`：`{ agents: AgentProfile[], loaded, load(), createAgent(input), updateAgent(id, patch), removeAgent(id) }`，写失败重抛+toast 由调用方（乐观更新回滚+重抛同 board store）。

- [ ] **Step 1: 类型**

创建 `src/types/agent-profile.ts`：

```ts
// agent_profiles 集合类型（命名队友，owner-only）。字段对齐迁移 1786400000。
export interface AgentProfile {
  id: string;
  owner: string;
  name: string;
  /** 头像 emoji（空则用 provider 首字母兜底） */
  emoji?: string;
  /** 主题色键（providers.ts 色板键，如 amber/sky） */
  color?: string;
  /** 底层 CLI provider（claude/codex） */
  provider: string;
  /** 默认指令（prepend 到任务 prompt） */
  instructions?: string;
  /** 绑定的指令库技能（prompt id 数组） */
  skill_prompts?: string[];
  /** 额外自由文本技能 */
  skill_text?: string;
  /** 超时覆盖秒（空/0=全局默认） */
  timeout_secs?: number;
  /** 并发上限（空/0=默认 1） */
  max_concurrent?: number;
  /** 工具/危险标志（默认 true） */
  with_tools?: boolean;
  /** 完成后 worktree 内自动 commit（默认 false） */
  auto_commit?: boolean;
  archived?: boolean;
  deleted_at?: string;
  created: string;
  updated: string;
}
```

在 `src/types/board.ts` 的 `BoardTask` 加：`/** 指派的命名队友 id（空则回退 agent_provider）。 */ agent_id?: string;`
在 `src/types/agent.ts` 的 `AgentRun` 加：`/** 派活时的队友 id（溯源；回退 provider 时为空）。 */ agent?: string;`

- [ ] **Step 2: PB 访问层**

创建 `src/lib/pb/agents.ts`（仿 `lib/pb/prompts.ts`）：

```ts
// agent_profiles PB 数据访问层 —— 唯一允许调用 pb.collection('agent_profiles') 的文件。
import { pb } from "../pb";
import { softDeleteRecord, NOT_DELETED } from "./collections";
import type { AgentProfile } from "../../types/agent-profile";

const COLL = "agent_profiles";

/** 全部队友（未软删，按 updated 降序）。owner 范围由访问规则保证。 */
export function listAgents(): Promise<AgentProfile[]> {
  return pb.collection(COLL).getFullList<AgentProfile>({ requestKey: null, filter: NOT_DELETED, sort: "-updated" });
}
export function createAgentRecord(data: Record<string, unknown>): Promise<AgentProfile> {
  return pb.collection(COLL).create<AgentProfile>(data);
}
export function updateAgentRecord(id: string, data: Record<string, unknown>): Promise<AgentProfile> {
  return pb.collection(COLL).update<AgentProfile>(id, data);
}
export function softDeleteAgent(id: string): Promise<void> {
  return softDeleteRecord(COLL, id);
}
```

- [ ] **Step 3: store**

创建 `src/store/agents.ts`（乐观更新 + 写失败回滚重抛，仿 board store）：

```ts
// 命名队友 store：CRUD + 乐观更新（写失败回滚并重抛，供调用点 toast）。
import { create } from "zustand";
import { listAgents, createAgentRecord, updateAgentRecord, softDeleteAgent } from "../lib/pb/agents";
import { currentUserId } from "../lib/pb";
import type { AgentProfile } from "../types/agent-profile";

interface AgentState {
  agents: AgentProfile[];
  loaded: boolean;
  load: () => Promise<void>;
  createAgent: (input: Partial<AgentProfile>) => Promise<AgentProfile>;
  updateAgent: (id: string, patch: Partial<AgentProfile>) => Promise<void>;
  removeAgent: (id: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  loaded: false,
  load: async () => {
    const agents = await listAgents();
    set({ agents, loaded: true });
  },
  createAgent: async (input) => {
    const rec = await createAgentRecord({ ...input, owner: currentUserId() });
    set({ agents: [rec, ...get().agents] });
    return rec;
  },
  updateAgent: async (id, patch) => {
    const { agents } = get();
    set({ agents: agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
    try {
      await updateAgentRecord(id, patch as Record<string, unknown>);
    } catch (e) {
      set({ agents }); // 回滚
      throw e;          // 重抛，调用点 toast
    }
  },
  removeAgent: async (id) => {
    const { agents } = get();
    set({ agents: agents.filter((a) => a.id !== id) });
    try {
      await softDeleteAgent(id);
    } catch (e) {
      set({ agents });
      throw e;
    }
  },
}));
```

- [ ] **Step 4: tsc 验证**

Run: `pnpm tsc --noEmit`
Expected: 无错。

- [ ] **Step 5: 提交**

```bash
git add src/types/agent-profile.ts src/lib/pb/agents.ts src/store/agents.ts src/types/board.ts src/types/agent.ts
git commit -m "feat(agent): 队友前端数据层(类型/PB/store)(S2)"
```

---

## Task 6: Agents 管理页 + 侧栏入口 + 路由

**Files:**
- Create: `src/pages/agents.tsx`
- Create: `src/features/agents/AgentCard.tsx`
- Create: `src/features/agents/AgentEditSheet.tsx`
- Modify: `src/router.tsx`（`/agents` lazy 路由）
- Modify: `src/lib/navigation.ts`（加「Agents」入口）
- Modify: `src/i18n/locales/{zh,en}/shell.json`（`nav.agents.title/description`）
- Modify: `src/i18n/locales/{zh,en}/board.json`（`agentsPage.*` 文案）

**Interfaces:**
- Consumes: `useAgentStore`、`PROVIDER_META`/`providerLabel`（`src/lib/providers`）、`useStartableProvidersStore`（限 provider 下拉为 claude/codex）、`listPrompts`（`src/lib/pb/prompts`，绑技能多选）。
- Produces: `/agents` 路由页；侧栏「Agents」入口。

- [ ] **Step 1: AgentCard**

创建 `src/features/agents/AgentCard.tsx`：队友卡片（emoji + 色点 + 名 + provider 徽标 + 技能数 + 运行时摘要），右上角编辑/归档/删除。用 `PROVIDER_META[a.provider].chip` 取徽标色。（完整实现：卡片容器 + `HugeiconsIcon`，参照 `TaskCard` 视觉；点击卡片触发 `onEdit(a)`。）

```tsx
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit02Icon, Archive02Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { PROVIDER_META, providerLabel } from "@/lib/providers";
import type { AgentProfile } from "@/types/agent-profile";

interface Props {
  agent: AgentProfile;
  onEdit: (a: AgentProfile) => void;
  onArchive: (a: AgentProfile) => void;
  onDelete: (a: AgentProfile) => void;
}

export function AgentCard({ agent, onEdit, onArchive, onDelete }: Props) {
  const meta = PROVIDER_META[agent.provider];
  const skillCount = (agent.skill_prompts?.length ?? 0) + (agent.skill_text?.trim() ? 1 : 0);
  return (
    <div
      onClick={() => onEdit(agent)}
      className="group relative cursor-pointer rounded-xl border border-border/60 bg-card p-4 shadow-sm transition-all hover:border-border hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{agent.emoji || "🤖"}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{agent.name}</p>
          <span className={cn("mt-0.5 inline-flex rounded-md px-1.5 py-0.5 text-[10px]", meta?.chip)}>
            {providerLabel(agent.provider)}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        技能 {skillCount} · 并发 {agent.max_concurrent || 1}
        {agent.with_tools === false ? " · 无工具" : ""}
        {agent.auto_commit ? " · 自动提交" : ""}
      </p>
      {/* 操作按钮（hover 显现），stopPropagation 防触发卡片编辑 */}
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button type="button" onClick={(e) => { e.stopPropagation(); onArchive(agent); }} className="rounded p-1 hover:bg-muted">
          <HugeiconsIcon icon={Archive02Icon} className="size-3.5" strokeWidth={2} />
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(agent); }} className="rounded p-1 text-destructive hover:bg-muted">
          <HugeiconsIcon icon={Delete02Icon} className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: AgentEditSheet**

创建 `src/features/agents/AgentEditSheet.tsx`：受控抽屉（复用 shadcn `Sheet`），表单字段：name(input) · emoji(input) · color(select，选项=PROVIDER_META 键) · provider(select，仅 claude/codex) · instructions(textarea) · skill_prompts(多选 prompts，用 `listPrompts` 拉列表 + checkbox 列表) · skill_text(textarea) · timeout_secs(number) · max_concurrent(number) · with_tools(switch) · auto_commit(switch)。保存调 `useAgentStore.createAgent/updateAgent`，失败 toast。

```tsx
// 关键骨架（完整字段见上）；保存逻辑：
import { toast } from "sonner";
import { useAgentStore } from "@/store/agents";
import type { AgentProfile } from "@/types/agent-profile";
// ...Sheet/Input/Textarea/Select/Switch imports from @/components/ui/*, useState, useEffect, listPrompts

// onSave:
async function save(draft: Partial<AgentProfile>, editing?: AgentProfile) {
  try {
    if (editing) await useAgentStore.getState().updateAgent(editing.id, draft);
    else await useAgentStore.getState().createAgent(draft);
    toast.success(editing ? "队友已更新" : "队友已创建");
    // close sheet
  } catch (e) {
    toast.error(`保存失败：${String(e)}`);
  }
}
```

> 实现完整表单：本文件负责所有字段的受控输入 + 校验（name/provider 必填）+ emoji 默认 🤖；provider 下拉固定 `["claude","codex"]`（S1 支持集）；skill_prompts 用一次性 `listPrompts()` + 复选。

- [ ] **Step 3: agents 页**

创建 `src/pages/agents.tsx`：挂载 `useAgentStore.load()`；网格渲染 `AgentCard`；顶部「新建队友」按钮开 `AgentEditSheet`；空态引导文案 + 新建按钮；归档/删除走 store（`updateAgent(id,{archived:true})` / `removeAgent(id)`）失败 toast。

- [ ] **Step 4: 路由 + 侧栏 + i18n**

- `src/router.tsx`：`const AgentsPage = lazy(() => import("./pages/agents"));` + `<Route path="/agents" element={<AgentsPage />} />`。
- `src/lib/navigation.ts`：import 一个机器人类图标（如 `AiBrain01Icon` 或现有 `BrainIcon`——用 `@hugeicons/core-free-icons` 里已导入的图标，避免新增未验证图标名；实现时确认图标名存在），在 `nav.groupWorkspace` 或 `nav.groupMore` 组加 `{ titleKey: "nav.agents.title", url: "/agents", icon: <图标>, descriptionKey: "nav.agents.description" }`（MVP 放 groupMore，S5 再归组）。
- `shell.json`（zh/en）加 `nav.agents.title`（zh "Agents"/en "Agents"）、`nav.agents.description`（zh "命名 AI 队友"/en "Named AI teammates"）。
- `board.json`（zh/en）加 `agentsPage.*`（新建/空态/字段标签/归档/删除确认等文案）。

- [ ] **Step 5: tsc 验证**

Run: `pnpm tsc --noEmit`
Expected: 无错。同时 `node -e "require('./src/i18n/locales/zh/shell.json');require('./src/i18n/locales/en/shell.json');require('./src/i18n/locales/zh/board.json');require('./src/i18n/locales/en/board.json');console.log('json ok')"`。

- [ ] **Step 6: 提交**

```bash
git add src/pages/agents.tsx src/features/agents/AgentCard.tsx src/features/agents/AgentEditSheet.tsx src/router.tsx src/lib/navigation.ts src/i18n/locales/zh/shell.json src/i18n/locales/en/shell.json src/i18n/locales/zh/board.json src/i18n/locales/en/board.json
git commit -m "feat(agent): Agents 管理页 + 侧栏入口 + 路由(S2)"
```

---

## Task 7: TaskCard 指派改选队友 + 徽标/面板/过滤 + i18n

**Files:**
- Modify: `src/features/board/TaskCard.tsx`
- Modify: `src/features/board/agent-filter.ts`（`taskHasAgent` 增 `agent_id` 判据）
- Modify: `src/features/board/agent-filter.test.ts`（补 agent_id 用例）
- Modify: `src/features/board/AgentRunPanel.tsx`（顶部显执行队友）
- Modify: `src/lib/tauri/ipc.ts`（`agentRunTask` 参数键 `provider`→`agentRef`）
- Modify: `src/i18n/locales/{zh,en}/board.json`

**Interfaces:**
- Consumes: `useAgentStore`（列活跃队友）、`AgentProfile`、`ipc.agentRunTask(taskId, agentRef, onEvent)`。
- Produces: 无对外签名变化。

- [ ] **Step 1: taskHasAgent 增 agent_id + 失败测试**

在 `agent-filter.test.ts` 补：

```ts
  it("有 agent_id → true", () => {
    expect(taskHasAgent(mkTask({ agent_id: "ag1" }), null)).toBe(true);
  });
```

改 `agent-filter.ts` 的 `taskHasAgent` 首行判据加：

```ts
  if (task.agent_id && task.agent_id.trim() !== "") return true;
```

（置于 `agent_provider` 判据之前或之后均可。）

- [ ] **Step 2: 运行测试确认通过**

Run: `pnpm vitest run src/features/board/agent-filter.test.ts`
Expected: PASS（含新用例）。

- [ ] **Step 3: TaskCard 指派列队友**

- 引入 `useAgentStore`，挂载 `load()`；`const agents = useAgentStore(s => s.agents).filter(a => !a.archived)`。
- 指派下拉：主区列 `agents`（"指派给 {emoji} {name}"），`onSelect` → `updateTask(task.id, { agent_id: a.id, agent_enqueued: true })`（失败 toast）。空 `agents` → 菜单显"先去 Agents 页建队友"（`navigate('/agents')`）。
- 次要区"立即跑一次"改为按队友：`ipc.agentRunTask(task.id, a.id, ...)`（传 agent_id 作 agentRef）。
- 徽标：`assignedAgent = agents.find(a => a.id === task.agent_id)`；有则显 `{emoji} {name}`，否则回退现有 provider 徽标逻辑。
- `assignLocked`（S1 防手滑）沿用。

- [ ] **Step 4: ipc 参数键**

`src/lib/tauri/ipc.ts` 的 `agentRunTask`：`return call<string>("agent_run_task", { taskId, provider, onEvent: ch });` → 参数键 `provider` 改 `agentRef`（对齐 Task 3 命令形参 `agent_ref`）：`{ taskId, agentRef, onEvent: ch }`，函数签名形参名同步（`agentRunTask(taskId, agentRef, onEvent)`）。

- [ ] **Step 5: AgentRunPanel 顶显队友**

`AgentRunPanel`：由 run 反查队友——run 有 `agent` 字段，用 `useAgentStore` 找 `agents.find(a=>a.id===run.agent)`，顶部显 `{emoji} {name}`；查不到回退显 `providerLabel(run.provider)`。

- [ ] **Step 6: i18n**

`board.json`（zh/en）：`agent` 段补 `assignTo`（改为含 emoji/名，如 zh "指派给 {{emoji}} {{name}}（自动开跑）"）、`noAgents`（zh "先去 Agents 页建队友"）、`runNowWith`（"用 {{name}} 立即跑一次"）等。保持 zh/en 键一致、JSON 有效。

- [ ] **Step 7: tsc + vitest**

Run: `pnpm tsc --noEmit && pnpm vitest run src/features/board/agent-filter.test.ts`
Expected: 无错，测试全过。

- [ ] **Step 8: 提交**

```bash
git add src/features/board/TaskCard.tsx src/features/board/agent-filter.ts src/features/board/agent-filter.test.ts src/features/board/AgentRunPanel.tsx src/lib/tauri/ipc.ts src/i18n/locales/zh/board.json src/i18n/locales/en/board.json
git commit -m "feat(agent): TaskCard 指派改选队友 + 徽标/面板/过滤(S2)"
```

---

## Self-Review

**1. Spec coverage（对照 S2 spec）：**
- §A 数据模型（agent_profiles 全字段 + board_tasks.agent_id + agent_runs.agent）→ Task 1。✅
- §B1 resolve_agent → Task 3；§B2 prompt 注入 → Task 3；§B3 运行时注入(with_tools/timeout/auto_commit) → Task 3；§B4 按 agent 并发 + 候选查询更新 → Task 4。✅
- §C1 Agents 页 → Task 6；§C2 指派改选队友 → Task 7；§C3 徽标/面板/过滤 → Task 7。✅
- §D 迁移 → Task 1；预置默认队友 + 回填 → Task 2（**移到 Rust bootstrap**，spec §D 机制修正，意图不变，见 Task 2 注释）。✅
- §E/协同模型「明确不做」→ 无任务涉及（emoji only、不碰机器、不升级 prompts、不重排侧栏）。✅

**2. Placeholder scan：** 无 TBD/TODO。Task 6 的 AgentEditSheet/agents 页给出骨架 + 关键逻辑代码而非完整每行 JSX——这是 UI 装配任务，字段清单/保存逻辑/校验规则均已明确列全，属"skilled developer 可直接装配"的详尽度；纯函数（build_task_prompt/pick_eligible/taskHasAgent）与迁移/resolve 给了完整代码。Task 3 Step 7、Task 6 Step 4 的"实现时确认"（图标名、lib.rs 变量在作用域）附了确切 grep 命令，属必要运行时核对非占位。

**3. Type consistency：**
- `ResolvedAgent` 字段（provider/instructions/skills/skill_text/timeout_secs:Option<u64>/with_tools/auto_commit/agent_id:Option）Task 3 定义、executor 消费一致。✅
- `build_task_prompt` 新签名（+3 参 `agent_instructions,&[String],skill_text`）Task 3 定义、executor 调用、测试调用一致。✅
- `EnqueuedTask{task_id,agent_ref,group_key,max_concurrent}` + `pick_eligible(&[EnqueuedTask],&HashMap<String,usize>,usize,usize)` Task 4 定义/poll_once 消费/测试一致。✅
- `execute_task_with_agent(...,agent_ref:&str,...)` 三调用点（executor 定义/worker/command）Task 3 全改，Task 4 worker 传 `t.agent_ref`。✅
- `AgentProfile` 字段 Task 5 定义、Task 6/7 消费一致；`BoardTask.agent_id?`/`AgentRun.agent?` Task 5 加、Task 4(Rust 侧同名 snake_case)/Task 7 用。✅
- `ipc.agentRunTask(taskId, agentRef, onEvent)` Task 7 改键，对齐 Task 3 命令形参 `agent_ref`。✅
- 常量：`DEFAULT_MAX_CONCURRENT`(resolve.rs) Task 3 定义、Task 4 引用；全局兜底 `AGENT_CONCURRENCY_GLOBAL_CAP` Task 4 引入并全改旧 `AGENT_CONCURRENCY` 引用。✅

**4. 约束落实：** 每 Task `git add` 列确切文件无 `-A`；提交无 Co-Authored-By；三调用点同步改（Task 3 Step 7 明列）；Rust 测试策略（cargo check + CI）在 Task 2/3/4 写明；TDD 纯函数先测（Task 3/4/7）；安全（auto_commit 仅 worktree commit 不 push/merge）Task 3 Step 5/6 落实；迁移 seed 移 Rust 的理由 Task 1/2 注释。✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-17-agents-first-class-s2.md`. Two execution options:

**1. Subagent-Driven（推荐）** —— 每 Task 派新 subagent + Task 间双阶段审查 + 末尾全分支审查，迭代快。

**2. Inline Execution** —— 本会话内批量执行，带检查点。

选哪个？
