// agent 任务自主执行：board_tasks 加 agent_provider/agent_enqueued；新集合 agent_runs。
// agent_runs = 每次「派 agent 执行」的运行记录(溯源+历史+重跑)；owner-only + 软删。
migrate((app) => {
  // 1) board_tasks 加字段
  const tasks = app.findCollectionByNameOrId("board_tasks");
  if (!tasks.fields.getByName("agent_provider")) {
    tasks.fields.add(new Field({ name: "agent_provider", type: "text", max: 40 }));
  }
  if (!tasks.fields.getByName("agent_enqueued")) {
    tasks.fields.add(new Field({ name: "agent_enqueued", type: "bool", required: false }));
  }
  app.save(tasks);

  // 2) agent_runs 集合
  const users = app.findCollectionByNameOrId("users");
  const auto = (name, onUpdate) =>
    new Field({ name, type: "autodate", onCreate: true, onUpdate: !!onUpdate });
  const runs = new Collection({
    name: "agent_runs",
    type: "base",
    listRule: `@request.auth.id != "" && owner = @request.auth.id`,
    viewRule: `@request.auth.id != "" && owner = @request.auth.id`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    updateRule: `owner = @request.auth.id`,
    deleteRule: `owner = @request.auth.id`,
  });
  runs.fields.add(new Field({ name: "owner", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 }));
  runs.fields.add(new Field({ name: "task", type: "text", required: true, max: 200 }));
  runs.fields.add(new Field({ name: "project", type: "text", required: true, max: 200 }));
  runs.fields.add(new Field({ name: "provider", type: "text", required: true, max: 40 }));
  // 运行状态机
  runs.fields.add(new Field({ name: "status", type: "select", required: true, maxSelect: 1,
    values: ["running", "review", "blocked", "merged", "discarded"] }));
  runs.fields.add(new Field({ name: "branch", type: "text", max: 200 }));
  runs.fields.add(new Field({ name: "worktree_path", type: "text", max: 500 }));
  runs.fields.add(new Field({ name: "exit_code", type: "number" }));
  runs.fields.add(new Field({ name: "blocker", type: "text", max: 2000 }));
  runs.fields.add(new Field({ name: "no_change", type: "bool", required: false }));
  runs.fields.add(new Field({ name: "diff_stat", type: "text", max: 500 }));
  // 日志尾部(截断)；text max 上限见运行时说明(PB 对 text 有 5000 强制上限)，故存尾部摘要
  runs.fields.add(new Field({ name: "log_tail", type: "text", max: 5000 }));
  runs.fields.add(new Field({ name: "deleted_at", type: "date" }));
  runs.fields.add(auto("started", false));
  runs.fields.add(auto("ended", true));
  runs.addIndex("idx_agent_runs_owner_task", false, "owner, task", "");
  app.save(runs);
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("agent_runs"));
  } catch (_) {}
  try {
    const tasks = app.findCollectionByNameOrId("board_tasks");
    for (const n of ["agent_provider", "agent_enqueued"]) {
      const f = tasks.fields.getByName(n);
      if (f) tasks.fields.removeById(f.id);
    }
    app.save(tasks);
  } catch (_) {}
});
