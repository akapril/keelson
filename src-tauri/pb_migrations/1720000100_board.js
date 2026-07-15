// rework Board 迁移：项目/状态/标签/任务/成员/模板 + 内置模板 seed。
// 每表 owner|project relation + access rules（单用户 owner-only；members 表建好留位，Phase⑤ 加成员规则）。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  // 字段工厂函数
  const rel = (name, collId, required, cascade) => new Field({
    name, type: "relation", required: !!required,
    collectionId: collId, cascadeDelete: !!cascade, maxSelect: 1,
  });
  const relMulti = (name, collId, max) => new Field({
    name, type: "relation", required: false, collectionId: collId,
    cascadeDelete: false, maxSelect: max,
  });
  const text = (name, required, max) => new Field({ name, type: "text", required: !!required, max: max || 0 });
  const sel = (name, values) => new Field({ name, type: "select", required: true, maxSelect: 1, values });
  const num = (name, required) => new Field({ name, type: "number", required: !!required });
  const bool = (name) => new Field({ name, type: "bool" });
  const json = (name, required) => new Field({ name, type: "json", required: !!required, maxSize: 65536 });
  const date = (name) => new Field({ name, type: "date" });
  // autodate：PB 0.30 base 表不自动加 created/updated，需显式添加（索引与 TS 类型都依赖它们）
  const auto = (name, onUpdate) => new Field({ name, type: "autodate", onCreate: true, onUpdate: !!onUpdate });

  // 访问规则常量：单用户 owner-only。
  // 注意：不能在建表时引用 board_project_members 的反向关系(board_project_members_via_project)，
  // 因为该表尚未创建、反向关系无法解析（会导致迁移失败）。member 传递子句留到 Phase⑤ 多用户时
  // 用单独迁移加回（members 表现已建好、届时反向关系可解析）。
  const ownerOrMember = `(project.owner = @request.auth.id)`;

  // 1) board_projects
  const projects = new Collection({
    name: "board_projects", type: "base",
    listRule:   `@request.auth.id != "" && owner = @request.auth.id`,
    viewRule:   `@request.auth.id != "" && owner = @request.auth.id`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    updateRule: `owner = @request.auth.id && @request.body.owner:changed = false`,
    deleteRule: `owner = @request.auth.id`,
  });
  projects.fields.add(rel("owner", users.id, true, true));
  projects.fields.add(text("name", true, 160));
  projects.fields.add(text("description", false, 2000));
  projects.fields.add(bool("archived"));
  projects.fields.add(text("repo_path", false, 500));
  projects.fields.add(auto("created", false));
  projects.fields.add(auto("updated", true));
  projects.addIndex("idx_bp_owner_updated", false, "owner, updated", "");
  projects.addIndex("idx_bp_owner_repo", false, "owner, repo_path", "");
  app.save(projects);
  const projId = app.findCollectionByNameOrId("board_projects").id;

  // 2) board_project_members（建表但单用户空）
  const members = new Collection({
    name: "board_project_members", type: "base",
    listRule:   `@request.auth.id != "" && ${ownerOrMember}`,
    viewRule:   `@request.auth.id != "" && ${ownerOrMember}`,
    createRule: `project.owner = @request.auth.id`,
    updateRule: `project.owner = @request.auth.id && @request.body.project:changed = false && @request.body.user:changed = false`,
    deleteRule: `project.owner = @request.auth.id`,
  });
  members.fields.add(rel("project", projId, true, true));
  members.fields.add(rel("user", users.id, true, false));
  members.fields.add(sel("role", ["admin", "member", "viewer"]));
  members.fields.add(auto("created", false));
  members.fields.add(auto("updated", true));
  members.addIndex("idx_bpm_project_user", true, "project, user", "");
  app.save(members);

  // 3) board_project_states
  const childRules = {
    listRule:   `@request.auth.id != "" && ${ownerOrMember}`,
    viewRule:   `@request.auth.id != "" && ${ownerOrMember}`,
    createRule: `project.owner = @request.auth.id`,
    updateRule: `project.owner = @request.auth.id && @request.body.project:changed = false`,
    deleteRule: `project.owner = @request.auth.id`,
  };
  const states = new Collection({ name: "board_project_states", type: "base", ...childRules });
  states.fields.add(rel("project", projId, true, true));
  states.fields.add(text("name", true, 100));
  states.fields.add(text("color", true, 20));
  states.fields.add(sel("category", ["pending", "active", "completed"]));
  states.fields.add(num("sort_order", true));
  states.fields.add(auto("created", false));
  states.fields.add(auto("updated", true));
  states.addIndex("idx_bps_project_name", true, "project, name", "");
  states.addIndex("idx_bps_project_order", false, "project, sort_order", "");
  app.save(states);
  const stateId = app.findCollectionByNameOrId("board_project_states").id;

  // 4) board_project_labels
  const labels = new Collection({ name: "board_project_labels", type: "base", ...childRules });
  labels.fields.add(rel("project", projId, true, true));
  labels.fields.add(text("name", true, 80));
  labels.fields.add(text("color", true, 20));
  labels.fields.add(auto("created", false));
  labels.fields.add(auto("updated", true));
  labels.addIndex("idx_bpl_project_name", true, "project, name", "");
  app.save(labels);
  const labelId = app.findCollectionByNameOrId("board_project_labels").id;

  // 5) board_tasks
  const tasks = new Collection({
    name: "board_tasks", type: "base",
    listRule:   `@request.auth.id != "" && ${ownerOrMember}`,
    viewRule:   `@request.auth.id != "" && ${ownerOrMember}`,
    createRule: `@request.auth.id != "" && ${ownerOrMember}`,
    updateRule: `${ownerOrMember} && @request.body.project:changed = false && @request.body.created_by:changed = false`,
    deleteRule: `${ownerOrMember}`,
  });
  tasks.fields.add(rel("project", projId, true, true));
  tasks.fields.add(rel("state", stateId, true, false));
  tasks.fields.add(text("title", true, 240));
  tasks.fields.add(text("description", false, 10000));
  tasks.fields.add(sel("priority", ["none", "low", "medium", "high", "urgent"]));
  tasks.fields.add(num("rank", false));
  tasks.fields.add(date("due_date"));
  tasks.fields.add(relMulti("assignees", users.id, 20));
  tasks.fields.add(relMulti("labels", labelId, 20));
  tasks.fields.add(rel("created_by", users.id, true, false));
  tasks.fields.add(text("source_session_id", false, 200));
  tasks.fields.add(text("source_provider", false, 40));
  tasks.fields.add(text("source_anchor", false, 200));
  tasks.fields.add(auto("created", false));
  tasks.fields.add(auto("updated", true));
  tasks.addIndex("idx_bt_project_state_rank", false, "project, state, rank", "");
  app.save(tasks);

  // 6) board_templates + seed（内置全局，owner 留空）
  const templates = new Collection({
    name: "board_templates", type: "base",
    listRule:   `@request.auth.id != "" && (owner = "" || owner = @request.auth.id)`,
    viewRule:   `@request.auth.id != "" && (owner = "" || owner = @request.auth.id)`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    updateRule: `owner = @request.auth.id && @request.body.owner:changed = false`,
    deleteRule: `owner = @request.auth.id`,
  });
  templates.fields.add(new Field({ name: "owner", type: "relation", required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 }));
  templates.fields.add(text("name", true, 120));
  templates.fields.add(text("description", false, 1000));
  templates.fields.add(json("states", true));
  templates.fields.add(json("labels", false));
  templates.fields.add(auto("created", false));
  templates.fields.add(auto("updated", true));
  templates.addIndex("idx_btpl_owner_name", true, "owner, name", "");
  app.save(templates);

  // 精选双语模板 seed（category: pending/active/completed）
  const seeds = [
    { name: "简易看板", description: "最简三列", states: [
      { name: "待处理", color: "#94a3b8", category: "pending" },
      { name: "进行中", color: "#3b82f6", category: "active" },
      { name: "已完成", color: "#22c55e", category: "completed" }], labels: [] },
    { name: "Simple Kanban", description: "Minimal three columns", states: [
      { name: "Backlog", color: "#94a3b8", category: "pending" },
      { name: "In Progress", color: "#3b82f6", category: "active" },
      { name: "Done", color: "#22c55e", category: "completed" }], labels: [] },
    { name: "软件开发", description: "开发流程", states: [
      { name: "待办", color: "#94a3b8", category: "pending" },
      { name: "进行中", color: "#3b82f6", category: "active" },
      { name: "测试中", color: "#a855f7", category: "active" },
      { name: "已完成", color: "#22c55e", category: "completed" }],
      labels: [ { name: "bug", color: "#ef4444" }, { name: "feature", color: "#3b82f6" }, { name: "重构", color: "#f59e0b" } ] },
    { name: "问题跟踪", description: "缺陷流转", states: [
      { name: "已报告", color: "#94a3b8", category: "pending" },
      { name: "处理中", color: "#3b82f6", category: "active" },
      { name: "验证中", color: "#a855f7", category: "active" },
      { name: "已解决", color: "#22c55e", category: "completed" }],
      labels: [ { name: "紧急", color: "#ef4444" }, { name: "回归", color: "#f59e0b" } ] },
  ];
  // 使用 new Record(collection) + rec.set(...) + app.save(rec) 播种内置全局模板
  for (const s of seeds) {
    const rec = new Record(templates);
    rec.set("owner", "");
    rec.set("name", s.name);
    rec.set("description", s.description);
    rec.set("states", s.states);
    rec.set("labels", s.labels);
    app.save(rec);
  }
}, (app) => {
  // 回滚：按依赖倒序删除各表
  for (const n of ["board_tasks", "board_project_labels", "board_project_states", "board_project_members", "board_templates", "board_projects"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
});
