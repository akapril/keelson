// 幂等补 agent_runs.base_branch 字段。
// 背景：原始迁移 1786300000_agent_runs.js 首次创建 agent_runs 集合时并无此字段；
// 后续 fix(2cf82a3「持久化 base_branch」)直接编辑了那个已应用的迁移文件加上该字段。
// 但 PocketBase 按文件名记录已应用迁移(_migrations 表)，一旦跑过便不再重跑——
// 于是在 2cf82a3 之前就建过库的旧环境，其 agent_runs 集合始终缺 base_branch 字段。
// 后果：executor 写入 base_branch 被 PB 静默丢弃 → 合并时读到空值 → 报「缺少 base_branch」。
// 这里用独立新迁移把字段补齐：旧库补上、新库(已有该字段)跳过，二者皆安全。
migrate((app) => {
  const runs = app.findCollectionByNameOrId("agent_runs");
  // 守卫：仅当缺失时才加，保证对新库(建集合即含此字段)幂等
  if (!runs.fields.getByName("base_branch")) {
    // 与原迁移定义保持一致：text，max 200（建 worktree 时持久化的 base 分支名）
    runs.fields.add(new Field({ name: "base_branch", type: "text", max: 200 }));
    app.save(runs);
  }
}, (app) => {
  // down：存在则移除（对未加过的库无副作用）
  try {
    const runs = app.findCollectionByNameOrId("agent_runs");
    const f = runs.fields.getByName("base_branch");
    if (f) {
      runs.fields.removeById(f.id);
      app.save(runs);
    }
  } catch (_) {}
});
