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
